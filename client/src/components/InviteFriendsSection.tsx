import { useEffect, useRef, useState } from 'react';
import { Copy, Send, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import { apiRequest } from '@/lib/queryClient';

export default function InviteFriendsSection() {
  const [sharing, setSharing] = useState(false);
  const queryClient = useQueryClient();
  const preparedShareRef = useRef<Promise<any> | null>(null);
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<any>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 300000 });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const claimMutation = useMutation({
    mutationFn: async (milestone?: number) => {
      const response = await apiRequest('POST', milestone ? '/api/referrals/milestones/claim' : '/api/referrals/claim', milestone ? { inviteTarget: milestone } : undefined);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Claim failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/referrals/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification('Referral reward claimed', 'success');
    },
    onError: (error: Error) => showNotification(error.message, 'error'),
  });
  const referralLink = user?.referralCode
    ? `https://t.me/${botInfo?.username || ''}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`
    : '';

  useEffect(() => {
    preparedShareRef.current = referralLink
      ? fetch('/api/share/prepare-message', { method: 'POST', credentials: 'include' }).then((r) => r.json()).catch(() => null)
      : null;
  }, [referralLink]);

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

  return (
    <section style={{ marginTop: 14, background: '#171717', borderRadius: 14, padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Users size={20} color="#c084fc" />
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>Invite Friends & Earn</div>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
        Invite friends and earn referral rewards automatically.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={share} disabled={!referralLink || sharing} style={{ flex: 1, height: 40, border: 0, borderRadius: 10, background: '#6b21a8', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Send size={16} />{sharing ? '...' : 'Invite Friends'}</button>
        <button onClick={copy} disabled={!referralLink} aria-label="Copy invite link" style={{ width: 42, height: 40, border: 0, borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Copy size={16} /></button>
      </div>
      <div style={{ marginTop: 14, color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Referral rewards to claim</div>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '10px 12px' }}>
          <div><div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>Available reward</div><div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{stats?.totalInvites ?? 0} friends invited</div></div>
          <button onClick={() => claimMutation.mutate(undefined)} disabled={claimMutation.isPending || Number(stats?.availableBonus || 0) <= 0} style={{ border: 0, borderRadius: 8, padding: '8px 12px', background: Number(stats?.availableBonus || 0) > 0 ? '#22c55e' : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 11, fontWeight: 800 }}>{claimMutation.isPending ? '...' : 'Claim Reward'}</button>
        </div>
        {[10, 25, 50].map((target) => <div key={target} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '10px 12px' }}><div><div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{target} Invite Bonus</div><div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{Math.min(stats?.totalInvites ?? 0, target)}/{target} invites</div></div><button onClick={() => claimMutation.mutate(target)} disabled={claimMutation.isPending || (stats?.totalInvites ?? 0) < target} style={{ border: 0, borderRadius: 8, padding: '8px 12px', background: (stats?.totalInvites ?? 0) >= target ? '#22c55e' : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 11, fontWeight: 800 }}>{(stats?.totalInvites ?? 0) >= target ? 'Claim Reward' : 'Locked'}</button></div>)}
      </div>
    </section>
  );
}
