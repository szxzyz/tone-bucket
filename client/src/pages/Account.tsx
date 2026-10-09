import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import MenuPopup from '@/components/GameMenuPopup';
import { User, Receipt, Shield, FileCheck2, CandlestickChart } from 'lucide-react';
import { RiBarChartFill } from 'react-icons/ri';
import { BsQuestionCircleFill } from 'react-icons/bs';
import { MdOutlineSupportAgent } from 'react-icons/md';
import { useAdmin } from '@/hooks/useAdmin';
import { useSupportLink } from '@/hooks/useSupportLink';
import { useLocation } from 'wouter';
import GameWithdrawPopup from '@/components/GameWithdrawPopup';
import PromoCodeInput from '@/components/PromoCodeInput';
import { useLanguage } from '@/hooks/useLanguage';

type AccountMenuView = 'transactions' | 'stats' | 'faq' | 'legal';
const ACCOUNT_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';

export default function Account() {
  const { isAdmin } = useAdmin();
  const supportLink = useSupportLink();
  const [, setLocation] = useLocation();
  const [menuView, setMenuView] = useState<AccountMenuView | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const { t } = useLanguage();

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], retry: false, staleTime: 300000 });
  const telegramUser = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user : null;
  const profilePhoto = telegramUser?.photo_url || user?.profileImageUrl || null;
  const displayName = user?.firstName || telegramUser?.first_name || 'User';
  const username = user?.telegramUsername || telegramUser?.username || null;
  const telegramId = user?.telegramId || telegramUser?.id?.toString() || null;
  const balanceLoaded = user?.balance !== undefined && user?.balance !== null;
  const rawBalance = balanceLoaded ? Number(user.balance) : 0;
  const gemBalance = rawBalance < 1 ? Math.round(rawBalance * 10_000_000) : Math.floor(rawBalance);
  const usdBalance = gemBalance / 100_000;
  // Match the Telegram bot's PAYOUTS inline button (TELEGRAM_PAYOUT_CHANNEL_LINK).
  // Keep the legacy proof URL as a fallback for deployments that still use it.
  const proofOfPaymentLink = String(appConfig?.payoutChannelUrl || appConfig?.proofOfPaymentLink || '').trim();

  const openSupport = () => {
    if (!supportLink) {
      showNotification('Support link is not configured', 'error');
      return;
    }
    const tgWebApp = (window as any).Telegram?.WebApp;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(supportLink);
    else window.open(supportLink, '_blank', 'noopener,noreferrer');
  };

  const openPaymentProof = () => {
    if (!proofOfPaymentLink) {
      showNotification('Payment proof link is not configured', 'error');
      return;
    }
    const tgWebApp = (window as any).Telegram?.WebApp;
    // Keep Telegram channel/bot links inside Telegram; ordinary web URLs use
    // the regular external-link opener.
    if (/^https?:\/\/t\.me\//i.test(proofOfPaymentLink) && tgWebApp?.openTelegramLink) {
      tgWebApp.openTelegramLink(proofOfPaymentLink);
    } else if (tgWebApp?.openLink) {
      tgWebApp.openLink(proofOfPaymentLink);
    }
    else window.open(proofOfPaymentLink, '_blank', 'noopener,noreferrer');
  };

  const menuActions = [
    { label: t('proof_of_payment'), icon: <FileCheck2 className="w-5 h-5 text-purple-400" />, action: openPaymentProof },
    { label: t('transactions'), icon: <Receipt className="w-5 h-5 text-yellow-400" />, action: () => setMenuView('transactions') },
    { label: t('project_statistics'), icon: <RiBarChartFill className="w-5 h-5 text-blue-400" />, action: () => setMenuView('stats') },
    { label: t('faqs'), icon: <BsQuestionCircleFill className="w-5 h-5 text-sky-400" />, action: () => setMenuView('faq') },
    { label: t('support'), icon: <MdOutlineSupportAgent className="w-5 h-5 text-pink-400" />, action: openSupport },
    { label: t('legal_info_short'), icon: <Shield className="w-5 h-5 text-purple-400" />, action: () => setMenuView('legal') },
  ];

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 pt-3 bg-black pb-[88px]">
        <div className="px-1 mb-3">
          <h1 className="m-0 text-xl font-black text-white">{t('profile')}</h1>
          <p className="m-0 mt-1 text-xs text-white/45">Manage your account and TON wallet payouts</p>
        </div>
        <section className="rounded-2xl p-4 mb-3" style={{ background: ACCOUNT_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <p className="text-white text-[13px] font-black uppercase tracking-widest mb-3">{t('account_info')}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { if (isAdmin) setLocation('/admin'); }}
              disabled={!isAdmin}
              aria-label={isAdmin ? 'Open admin panel' : 'Profile'}
              className={`w-14 h-14 rounded-full overflow-hidden border border-white/10 bg-[#1b1b1b] flex items-center justify-center flex-shrink-0 ${isAdmin ? 'cursor-pointer active:scale-95 transition-transform' : 'cursor-default'}`}
            >
              {profilePhoto ? <img src={profilePhoto} alt="Profile" className="w-full h-full object-cover" /> : <User className="w-6 h-6 text-white/40" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">{displayName}</p>
              {username && <p className="text-white/50 text-xs mt-0.5">@{username}</p>}
              {telegramId && <p className="text-white/30 text-[10px] mt-1 font-mono">ID: {telegramId}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl px-3 py-3 mb-3 flex items-center gap-3" aria-label="AXN balance" style={{ background: ACCOUNT_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <img src="/assets/axionet-mining.webp" alt="AXN" className="w-9 h-9 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white/55 text-[11px] font-bold uppercase tracking-wider leading-4">{t('balance')}</p>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-white text-lg font-black tabular-nums truncate">{balanceLoaded ? gemBalance.toLocaleString() : '—'}</span>
              <span className="text-white/55 text-[11px] font-extrabold">AXN</span>
            </div>
            <p className="text-white/40 text-[10px] font-semibold tabular-nums">~${balanceLoaded ? usdBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'} USD</p>
          </div>
          <button type="button" onClick={() => setWithdrawOpen(true)} disabled={!balanceLoaded} className="h-9 px-4 rounded-xl text-white text-xs font-black uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #2563eb, #3b82f6)' }}>{t('withdraw')}</button>
        </section>

        <section className="mb-3" aria-label="AXN market actions">
          <button type="button" onClick={() => setLocation('/axn-market')} className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-white text-xs font-black active:scale-95 transition-transform" style={{ background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)', boxShadow: '0 5px 14px rgba(0,0,0,.22)' }}><CandlestickChart className="w-4 h-4 text-blue-300" />Buy/Sell AXIONET</button>
        </section>
        <section className="rounded-2xl p-3 mb-3" aria-label="Promo code" style={{ background: ACCOUNT_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <p className="text-white text-[13px] font-black uppercase tracking-widest mb-3">Promo Code</p>
          <PromoCodeInput />
        </section>

        <section className="space-y-2 mb-3" aria-label="Account actions">
          {menuActions.map(({ label, icon, action }) => (
            <button key={label} onClick={action} className="w-full flex items-center justify-between rounded-2xl p-4 hover:brightness-110 transition-all active:scale-[0.99]" style={{ background: ACCOUNT_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
              <div className="flex items-center gap-3">{icon}<span className="text-white font-bold text-sm">{label}</span></div>
            </button>
          ))}
        </section>
      </main>

      <GameWithdrawPopup open={withdrawOpen} onClose={() => setWithdrawOpen(false)} userBalance={gemBalance} />

      {menuView && <MenuPopup key={menuView} onClose={() => setMenuView(null)} initialView={menuView} />}
    </Layout>
  );
}
