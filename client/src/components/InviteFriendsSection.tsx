import { useEffect, useRef, useState } from 'react';
import { Copy, Send, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import { apiRequest } from '@/lib/queryClient';

export default function InviteFriendsSection() {
  const [sharing, setSharing] = useState(false);
  const preparedShareRef = useRef<Promise<any> | null>(null);
  const queryClient = useQueryClient();
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<any>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 300000 });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const referralLink = user?.referralCode ? `https://t.me/${botInfo?.username || ''}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}` : '';
  const l1Percent = appSettings?.l1CommissionPercent ?? 20;
  const l2Percent = appSettings?.l2CommissionPercent ?? 4;
  const l1Income = Number(stats?.totalL1Earned || 0);
  const l2Income = Number(stats?.totalL2Earned || 0);
  const availableBonus = Number(stats?.availableBonus || 0);

  useEffect(() => {
    preparedShareRef.current = referralLink
      ? fetch('/api/share/prepare-message', { method: 'POST', credentials: 'include' }).then((r) => r.json()).catch(() => null)
      : null;
  }, [referralLink]);

  const claimReferralMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/referrals/claim');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Claim failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/referrals/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification('Reward claimed successfully', 'success');
    },
    onError: (error: Error) => showNotification(error.message || 'Unable to claim reward', 'error'),
  });

  const copy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    showNotification('Invite link copied', 'success');
  };

  const share = async () => {
    if (!referralLink || sharing) return;
    setSharing(true);
    try {
      const data = await (preparedShareRef.current || Promise.resolve(null));
      const tg = (window as any).Telegram?.WebApp;
      if (data?.success && tg?.shareMessage) tg.shareMessage(data.messageId, () => undefined);
      else {
        const url = data?.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`;
        tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank');
      }
    } finally { setSharing(false); }
  };

  const incomeCards = [
    { level: 1, income: l1Income, count: stats?.totalInvites ?? 0, percent: l1Percent },
    { level: 2, income: l2Income, count: stats?.l2Count ?? 0, percent: l2Percent },
  ];

  return (
    <section style={{ marginTop: 14, background: '#171717', borderRadius: 14, padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Users size={20} color="#c084fc" /><div style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>Invite Friends</div></div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>Invite friends and earn income from your Level 1 and Level 2 referrals.</div>
      <div style={{ display: 'flex', gap: 8 }}><button onClick={share} disabled={!referralLink || sharing} style={{ flex: 1, height: 40, border: 0, borderRadius: 10, background: '#6b21a8', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Send size={16} />{sharing ? '...' : 'Invite Friends'}</button><button onClick={copy} disabled={!referralLink} aria-label="Copy invite link" style={{ width: 42, height: 40, border: 0, borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Copy size={16} /></button></div>
      <div style={{ color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 16, marginBottom: 8 }}>Income from friends</div>
      {incomeCards.map(({ level, income, count, percent }) => (
        <div key={level} style={{ width: '100%', borderRadius: 14, marginBottom: 8, overflow: 'hidden', background: '#111' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 0' }}>
            <div style={{ minWidth: 0 }}><div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Income to collect</div><div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 }}>Level {level} · {percent}% from friends</div></div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}><div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Friends</div><div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{count}</div></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 12px' }}><div style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, color: '#fff', fontSize: 16, fontWeight: 900 }}><img src="/assets/gem-icon.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />{income.toLocaleString()} GOLD</div><button onClick={() => claimReferralMutation.mutate()} disabled={claimReferralMutation.isPending || availableBonus <= 0} style={{ width: 92, height: 38, padding: 0, border: 0, borderRadius: 12, color: availableBonus > 0 ? '#fff' : 'rgba(255,255,255,0.3)', background: availableBonus > 0 ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.06)', fontSize: 12, fontWeight: 700 }}>{claimReferralMutation.isPending ? '...' : 'Collect'}</button></div>
        </div>
      ))}
    </section>
  );
}
