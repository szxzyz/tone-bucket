import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";

function DailyTaskItem({ icon, title, subtitle, buttonLabel, goldReward = 0, isCompleted, isClaimed, onAction, onClaim }: any) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px',
        width: '100%', boxSizing: 'border-box', background: '#171717',
        borderRadius: 14, marginBottom: 10,
      }}
      onClick={isClaimed ? undefined : (isCompleted ? onClaim : onAction)}
    >
      <div style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={icon} alt="" loading="lazy" decoding="async" style={{ width: 36, height: 36, objectFit: 'contain' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>{title}</div>
        {subtitle ? <div style={{ color: isCompleted ? '#22c55e' : 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 4, lineHeight: 1.25 }}>{subtitle}</div> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#fff' }}>
            <img src="/assets/gold-icon.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />
            <span style={{ fontSize: 16, fontWeight: 900, color: '#ffffff' }}>{Number(goldReward).toLocaleString()}</span>
          </span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); isCompleted ? onClaim() : onAction(); }}
        disabled={isClaimed}
        style={{
          background: isClaimed ? 'rgba(255,255,255,0.06)' : isCompleted ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
          color: isClaimed ? 'rgba(255,255,255,0.3)' : '#fff', border: 'none', width: buttonLabel === 'Share' ? 78 : 70,
          height: 38, boxSizing: 'border-box' as const, borderRadius: 10, padding: 0, fontSize: 12, fontWeight: 800,
          cursor: isClaimed ? 'not-allowed' : 'pointer', flexShrink: 0, letterSpacing: '0.03em',
          boxShadow: isClaimed ? 'none' : isCompleted ? '0 2px 12px rgba(34,197,94,0.4)' : '0 2px 12px rgba(37,99,235,0.4)',
        }}
        className="active:scale-95 transition-transform"
      >
        {isClaimed ? 'DONE' : isCompleted ? 'CLAIM' : buttonLabel}
      </button>
    </div>
  );
}

export default function DailyMissionTasks() {
  const queryClient = useQueryClient();
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], staleTime: 5 * 60_000, retry: false });
  const { data: missionStatus } = useQuery<any>({ queryKey: ['/api/missions/status'], retry: false });

  const claimMissionMutation = useMutation({
    mutationFn: async ({ type, goalType }: { type: string; goalType?: string }) => {
      const endpoint = type === 'ads_goal' ? '/api/missions/ads-goal/claim' : `/api/missions/${type.replace(/_/g, '-')}/claim`;
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goalType }), credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to claim');
      return data;
    },
    onSuccess: (data) => {
      showNotification(data.message || 'Reward claimed!', 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/missions/status'] });
    },
    onError: (err: Error) => showNotification(err.message, 'error'),
  });

  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 }}>
        Daily Missions
      </div>
      <DailyTaskItem
        icon="/assets/check-updates.png" title="Check for updates" subtitle="" buttonLabel="Go" goldReward={100}
        isCompleted={missionStatus?.checkForUpdates?.completed} isClaimed={missionStatus?.checkForUpdates?.claimed}
        onAction={() => {
          const url = appConfig?.updateUrl || appConfig?.channelUrl || 'https://t.me/SwagBuxBot';
          if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(url); else window.open(url, '_blank');
          setTimeout(() => claimMissionMutation.mutate({ type: 'check_for_updates' }), 2000);
        }}
        onClaim={() => claimMissionMutation.mutate({ type: 'check_for_updates' })}
      />
      <DailyTaskItem
        icon="/assets/share-with-friends.png" title="Share With Friends" subtitle="" buttonLabel="Share" goldReward={100}
        isCompleted={missionStatus?.shareReferral?.completed} isClaimed={missionStatus?.shareReferral?.claimed}
        onAction={async () => {
          try {
            const res = await fetch('/api/share/prepare-message', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success && window.Telegram?.WebApp?.shareMessage) {
              window.Telegram.WebApp.shareMessage(data.messageId, (sent: boolean) => { if (sent) claimMissionMutation.mutate({ type: 'share_referral' }); });
            } else {
              const link = data.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(data.referralLink)}`;
              if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(link); else window.open(link, '_blank');
              setTimeout(() => claimMissionMutation.mutate({ type: 'share_referral' }), 3000);
            }
          } catch (e) { console.error(e); }
        }}
        onClaim={() => claimMissionMutation.mutate({ type: 'share_referral' })}
      />
    </section>
  );
}
