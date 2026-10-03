import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Send } from 'lucide-react';
import Layout from '@/components/Layout';
import { formatLargeSWAG } from '@/lib/utils';
import { showNotification } from '@/components/AppNotification';
import { useLanguage } from '@/hooks/useLanguage';

const FRIENDS_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';
const INVITE_BUTTON_BACKGROUND = 'linear-gradient(135deg, #2563eb, #3b82f6)';
const formatReward = (value: number) => Math.trunc(value).toLocaleString();
const formatWorthUsd = (value: number) => `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;

export default function Affiliates() {
  const { t } = useLanguage();
  const [isSharing, setIsSharing] = useState(false);
  const preparedShareRef = useRef<Promise<any> | null>(null);
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 5 * 60 * 1000 });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const settingsLoaded = appSettings !== undefined;
  const joinReward = Math.max(0, Number(appSettings?.referralJoinRewardGold ?? 0) || 0);
  const activeReward = Math.max(0, Number(appSettings?.referralActiveRewardGold ?? 2500) || 0);
  const totalReward = joinReward + activeReward;
  const gemsPerUsd = Math.max(1, Number(appSettings?.padPerUsd ?? 100000) || 100000);
  const worthUsd = totalReward / gemsPerUsd;
  const commissionPercent = Math.max(0, Number(appSettings?.l1CommissionPercent ?? 5) || 0);
  const totalFriends = Number(stats?.totalInvites ?? 0);
  const activeFriends = Number(stats?.successfulInvites ?? 0);
  const totalEarned = Number(stats?.totalReferralBonusEarned || stats?.totalL1Earned || 0);
  const referralLink = user?.referralCode
    ? `https://t.me/${botInfo?.username || ''}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`
    : '';

  const prepareShareMessage = () => {
    if (!referralLink) return Promise.resolve(null);
    if (!preparedShareRef.current) {
      preparedShareRef.current = fetch('/api/share/prepare-message', { method: 'POST', credentials: 'include' })
        .then((response) => response.json()).catch(() => null);
    }
    return preparedShareRef.current;
  };

  useEffect(() => {
    preparedShareRef.current = null;
    if (referralLink) void prepareShareMessage();
  }, [referralLink]);

  const inviteFriends = async () => {
    if (isSharing || !referralLink) return;
    setIsSharing(true);
    try {
      const data = await prepareShareMessage();
      const tgWebApp = (window as any).Telegram?.WebApp;
      if (data?.success && tgWebApp?.shareMessage) tgWebApp.shareMessage(data.messageId, () => undefined);
      else {
        const fallbackUrl = data?.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`;
        if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(fallbackUrl);
        else window.open(fallbackUrl, '_blank');
      }
    } finally { setIsSharing(false); }
  };

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      showNotification(t('link_copied'), 'success');
    } catch {
      showNotification('Could not copy referral link', 'error');
    }
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 pt-3 bg-black pb-0 text-white">
        <section className="rounded-[16px] p-3 mb-3 overflow-hidden" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <div className="text-white text-[15px] font-black mb-3">Per friend you invite</div>
          <div className="rounded-xl p-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.045)' }}>
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <img src="/assets/gems-icon.svg" alt="GEM" className="w-7 h-7 object-contain shrink-0" />
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-white text-xl font-black tabular-nums truncate">{settingsLoaded ? formatReward(totalReward) : '…'}</span>
                  <span className="text-white text-xs font-extrabold uppercase tracking-wider shrink-0">GEM</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-white/45 text-[10px] font-bold uppercase tracking-wider">Worth</div>
                <div className="text-white text-sm font-black whitespace-nowrap">{settingsLoaded ? formatWorthUsd(worthUsd) : '…'}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-3">
              {[
                ['On join', settingsLoaded ? `+${formatReward(joinReward)} GEM` : '…'],
                ['When active', settingsLoaded ? `+${formatReward(activeReward)} GEM` : '…'],
                ['Forever', settingsLoaded ? `${commissionPercent}% Commission` : '…'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl px-1.5 py-2 min-w-0" style={{ background: 'rgba(0,0,0,0.28)' }}>
                  <div className="text-white/45 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">{label}</div>
                  <div className="text-white text-xs font-black mt-1 whitespace-nowrap tabular-nums">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[14px] p-2 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Friends', totalFriends],
              ['Active', activeFriends],
              ['Earned GEM', formatLargeSWAG(totalEarned, false)],
            ].map(([label, value]) => (
              <div key={String(label)} className="text-center rounded-lg py-2" style={{ background: 'rgba(255,255,255,0.045)' }}>
                <div className="text-white text-sm font-black tabular-nums truncate">{value}</div>
                <div className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-1 truncate">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={inviteFriends} disabled={isSharing || !referralLink} className="flex-1 h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }}>
            <Send className="w-4 h-4 text-white" />
            <span className="text-white font-bold text-xs">{isSharing ? 'Opening…' : 'Invite Friends'}</span>
          </button>
          <button onClick={copyLink} disabled={!referralLink} className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }} title="Copy referral link" aria-label="Copy referral link">
            <Copy className="w-4 h-4 text-white" />
          </button>
        </div>

        <div style={{ height: 104, flexShrink: 0 }} />
      </main>
    </Layout>
  );
}
