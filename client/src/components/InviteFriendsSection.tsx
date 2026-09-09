import { useEffect, useRef, useState } from 'react';
import { Copy, Send, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';

export default function InviteFriendsSection() {
  const [sharing, setSharing] = useState(false);
  const preparedShareRef = useRef<Promise<any> | null>(null);
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<any>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 300000 });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const referralLink = user?.referralCode ? `https://t.me/${botInfo?.username || ''}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}` : '';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Users size={20} color="#c084fc" /><div style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>Invite Friends</div></div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>Earn 250 GOLD for each qualifying invite, plus income from your Level 1 and Level 2 referrals.</div>
      <div style={{ display: 'flex', gap: 8 }}><button onClick={share} disabled={!referralLink || sharing} style={{ flex: 1, height: 40, border: 0, borderRadius: 10, background: '#6b21a8', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Send size={16} />{sharing ? '...' : 'Invite Friends'}</button><button onClick={copy} disabled={!referralLink} aria-label="Copy invite link" style={{ width: 42, height: 40, border: 0, borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Copy size={16} /></button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '11px 12px' }}><div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 800 }}>PER INVITE</div><div style={{ color: '#facc15', fontSize: 17, fontWeight: 900, marginTop: 3 }}>250 GOLD</div><div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{stats?.totalInvites ?? 0} invites</div></div>
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '11px 12px' }}><div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 800 }}>LEVEL 1 INCOME</div><div style={{ color: '#c084fc', fontSize: 17, fontWeight: 900, marginTop: 3 }}>{Number(stats?.totalL1Earned || 0).toLocaleString()} GOLD</div><div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Direct referrals</div></div>
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '11px 12px', gridColumn: '1 / -1' }}><div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 800 }}>LEVEL 2 INCOME</div><div style={{ color: '#c084fc', fontSize: 17, fontWeight: 900, marginTop: 3 }}>{Number(stats?.totalL2Earned || 0).toLocaleString()} GOLD</div><div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{stats?.l2Count ?? 0} indirect referrals</div></div>
      </div>
    </section>
  );
}
