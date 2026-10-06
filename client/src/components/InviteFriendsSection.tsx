import { useEffect, useRef, useState } from 'react';
import { Copy, Send, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import { useLanguage } from '@/hooks/useLanguage';

export default function InviteFriendsSection() {
  const { t } = useLanguage();
  const [sharing, setSharing] = useState(false);
  const preparedShareRef = useRef<Promise<any> | null>(null);
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<any>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 300000 });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const referralLink = user?.referralCode ? `https://t.me/${botInfo?.username || ''}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}` : '';
  const commissionPercent = Number(appSettings?.l1CommissionPercent ?? 5);
  const income = Number(stats?.totalL1Earned || 0);

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
    <section style={{ marginTop: 14, background: '#252525', borderRadius: 14, padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Users size={20} color="#c084fc" /><div style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>{t('invite_friends')}</div></div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>{t('invite_friends_hint')}</div>
      <div style={{ display: 'flex', gap: 8 }}><button onClick={share} disabled={!referralLink || sharing} style={{ flex: 1, height: 40, border: 0, borderRadius: 10, background: '#252525', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Send size={16} />{sharing ? '...' : t('invite_friends')}</button><button onClick={copy} disabled={!referralLink} aria-label="Copy invite link" style={{ width: 42, height: 40, border: 0, borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Copy size={16} /></button></div>
      <div style={{ color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 16, marginBottom: 8 }}>{t('income_from_friends')}</div>
      <div style={{ width: '100%', borderRadius: 14, marginBottom: 8, overflow: 'hidden', background: '#111' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 0' }}>
          <div style={{ minWidth: 0 }}><div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>{t('income_credited')}</div><div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 }}>{commissionPercent}% forever from direct friends</div></div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}><div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('friends')}</div><div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{stats?.totalInvites ?? 0}</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 12px' }}><div style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, color: '#fff', fontSize: 16, fontWeight: 900 }}><img src="/assets/gems-icon.svg" alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />{income.toLocaleString()} AXN</div></div>
      </div>
    </section>
  );
}
