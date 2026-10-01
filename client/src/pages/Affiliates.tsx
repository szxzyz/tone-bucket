import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import MenuPopup from '@/components/GameMenuPopup';
import { Copy, Users, Send, CheckCircle2, Clock3, User, UserPlus, Receipt, ChevronRight, Shield } from 'lucide-react';
import { RiBarChartFill } from 'react-icons/ri';
import { BsQuestionCircleFill } from 'react-icons/bs';
import { MdOutlineSupportAgent } from 'react-icons/md';
import { formatLargeSWAG } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';
import { useAdmin } from '@/hooks/useAdmin';
import { useSupportLink } from '@/hooks/useSupportLink';
import { useLocation } from 'wouter';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';

const FRIENDS_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';
const formatRewardGold = (value: number) => Math.trunc(value).toLocaleString();
const formatWorthUsd = (value: number) => `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;
type FriendsMenuView = 'transactions' | 'stats' | 'faq' | 'legal';

export default function Affiliates() {
  const { t } = useLanguage();
  const { isAdmin } = useAdmin();
  const supportLink = useSupportLink();
  const [, setLocation] = useLocation();
  const [referralsOpen, setReferralsOpen] = useState(false);
  const [referralsPage, setReferralsPage] = useState(1);
  const [isSharing, setIsSharing] = useState(false);
  const [menuView, setMenuView] = useState<FriendsMenuView | null>(null);
  const preparedShareRef = useRef<Promise<any> | null>(null);

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const { data: myReferralsData, isLoading: isLoadingReferrals } = useQuery<any>({
    queryKey: ['/api/referrals/my-referrals', referralsPage],
    queryFn: async () => {
      const response = await fetch(`/api/referrals/my-referrals?page=${referralsPage}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load friends');
      return response.json();
    },
    retry: false,
    enabled: referralsOpen,
    placeholderData: (previousData: any) => previousData,
  });
  const { data: botInfo } = useQuery<{ username: string }>({
    queryKey: ['/api/bot-info'], retry: false, staleTime: 5 * 60 * 1000,
  });

  const telegramUser = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user : null;
  const profilePhoto = telegramUser?.photo_url || user?.profileImageUrl || null;
  const displayName = user?.firstName || telegramUser?.first_name || 'User';
  const username = user?.telegramUsername || telegramUser?.username || null;
  const telegramId = user?.telegramId || telegramUser?.id?.toString() || null;
  const botUsername = botInfo?.username || '';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`
    : '';
  const settingsLoaded = appSettings !== undefined;
  const joinRewardGold = Math.max(0, Number(appSettings?.referralJoinRewardGold ?? 0) || 0);
  const activeRewardGold = Math.max(0, Number(appSettings?.referralActiveRewardGold ?? 2500) || 0);
  const totalRewardGold = joinRewardGold + activeRewardGold;
  const padPerUsd = Math.max(1, Number(appSettings?.padPerUsd ?? 100000) || 100000);
  const goldWorthUsd = totalRewardGold / padPerUsd;
  const commissionPercent = Math.max(0, Number(appSettings?.l1CommissionPercent ?? 5) || 0);

  const totalFriends = Number(stats?.totalInvites ?? 0);
  const activeFriends = Number(stats?.successfulInvites ?? 0);
  const totalEarned = Number(stats?.totalReferralBonusEarned || stats?.totalL1Earned || 0);
  const myReferrals: any[] = myReferralsData?.referrals || [];
  const referralsTotal = Number(myReferralsData?.total ?? myReferrals.length);
  const referralsTotalPages = Math.max(1, Number(myReferralsData?.totalPages ?? 1));

  const copyLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    showNotification(t('link_copied'), 'success');
  };

  const prepareShareMessage = () => {
    if (!referralLink) return Promise.resolve(null);
    if (!preparedShareRef.current) {
      preparedShareRef.current = fetch('/api/share/prepare-message', { method: 'POST', credentials: 'include' })
        .then((res) => res.json()).catch(() => null);
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

  const openSupport = () => {
    if (!supportLink) {
      showNotification('Support link is not configured', 'error');
      return;
    }
    const tgWebApp = (window as any).Telegram?.WebApp;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(supportLink);
    else window.open(supportLink, '_blank', 'noopener,noreferrer');
  };

  const menuActions = [
    { label: 'Transactions', icon: <Receipt className="w-5 h-5 text-yellow-400" />, action: () => setMenuView('transactions') },
    { label: 'My invites', icon: <UserPlus className="w-5 h-5 text-emerald-400" />, action: () => setReferralsOpen(true) },
    { label: 'Project Statistics', icon: <RiBarChartFill className="w-5 h-5 text-blue-400" />, action: () => setMenuView('stats') },
    { label: 'FAQs', icon: <BsQuestionCircleFill className="w-5 h-5 text-sky-400" />, action: () => setMenuView('faq') },
    { label: 'Support', icon: <MdOutlineSupportAgent className="w-5 h-5 text-pink-400" />, action: openSupport },
    { label: 'Legal & Info', icon: <Shield className="w-5 h-5 text-purple-400" />, action: () => setMenuView('legal') },
  ];

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 pt-3 bg-black pb-0">
        <section className="rounded-2xl p-4 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Account Info</p>
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

        <section className="rounded-[16px] p-3 mb-3 overflow-hidden" style={{ background: FRIENDS_CARD_BACKGROUND }}>
          <div className="text-white text-[15px] font-black mb-3">Per friend you invite</div>
          <div className="rounded-xl p-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.045)' }}>
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <img src="/assets/gems-icon.svg" alt="GEM" className="w-7 h-7 object-contain shrink-0" />
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-white text-xl font-black tabular-nums truncate">{settingsLoaded ? formatRewardGold(totalRewardGold) : '…'}</span>
                  <span className="text-white text-xs font-extrabold uppercase tracking-wider shrink-0">GEM</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-white/45 text-[10px] font-bold uppercase tracking-wider">Worth</div>
                <div className="text-white text-sm font-black whitespace-nowrap">{settingsLoaded ? formatWorthUsd(goldWorthUsd) : '…'}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-3">
              {[
                ['On join', settingsLoaded ? `+${formatRewardGold(joinRewardGold)} GEM` : '…'],
                ['When active', settingsLoaded ? `+${formatRewardGold(activeRewardGold)} GEM` : '…'],
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

        <section className="rounded-[14px] p-2 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND }}>
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
          <button onClick={inviteFriends} disabled={isSharing || !referralLink} className="flex-1 h-11 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
            <Send className="w-4 h-4 text-white" />
            <span className="text-white font-bold text-xs">{isSharing ? 'Opening…' : 'Invite Friends'}</span>
          </button>
          <button onClick={copyLink} disabled={!referralLink} className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }} title="Copy referral link">
            <Copy className="w-4 h-4 text-white" />
          </button>
        </div>

        <section className="space-y-2 mb-3" aria-label="More">
          {menuActions.map(({ label, icon, action }) => (
            <button key={label} onClick={action} className="w-full flex items-center justify-between rounded-2xl p-4 hover:brightness-110 transition-all active:scale-[0.99]" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
              <div className="flex items-center gap-3">{icon}<span className="text-white font-bold text-sm">{label}</span></div>
              <ChevronRight className="w-4 h-4 text-white/30" />
            </button>
          ))}
        </section>

        <div style={{ height: 104, flexShrink: 0 }} />
      </main>

      <Drawer open={referralsOpen} onOpenChange={(open) => { setReferralsOpen(open); if (open) setReferralsPage(1); }}>
        <DrawerContent className="bg-[#111] border-none max-h-[80vh]">
          <DrawerHeader className="flex items-center justify-between pb-2"><DrawerTitle className="text-white font-bold text-lg">My invites</DrawerTitle><DrawerClose asChild><button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10">Close</button></DrawerClose></DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {isLoadingReferrals ? <div className="text-white/40 text-sm text-center py-10">Loading…</div> : myReferrals.length === 0 ? <div className="flex flex-col items-center py-10 gap-2"><Users className="w-10 h-10 text-white/20" /><p className="text-white/40 text-sm">No invites yet</p></div> : <>
              <div className="grid grid-cols-2 gap-2 pb-2 border-b border-white/10 mb-2"><span className="text-[#888] text-xs font-semibold uppercase tracking-wider">Friend</span><span className="text-[#888] text-xs font-semibold uppercase tracking-wider text-right">Status</span></div>
              <div className="space-y-2">{myReferrals.map((ref: any) => <div key={ref.id} className="grid grid-cols-2 gap-2 items-center py-2 border-b border-white/5"><div className="min-w-0"><p className="text-white text-sm font-medium truncate">{ref.username ? `@${ref.username}` : ref.displayName}</p>{ref.username && ref.displayName && ref.displayName !== ref.username && <p className="text-[#888] text-xs truncate">{ref.displayName}</p>}</div><div className="flex justify-end">{ref.status === 'success' ? <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[11px] px-2"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge> : <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[11px] px-2"><Clock3 className="w-3 h-3 mr-1" />Pending</Badge>}</div></div>)}</div>
              <div className="flex items-center justify-between gap-3 mt-4">
                <button onClick={() => setReferralsPage((page) => Math.max(1, page - 1))} disabled={referralsPage <= 1} className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-white/10 disabled:opacity-30">Previous</button>
                <span className="text-white/50 text-xs tabular-nums">{referralsPage} / {referralsTotalPages}</span>
                <button onClick={() => setReferralsPage((page) => Math.min(referralsTotalPages, page + 1))} disabled={referralsPage >= referralsTotalPages} className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-white/10 disabled:opacity-30">Next</button>
              </div>
              <p className="text-[#666] text-xs mt-3 text-center">{referralsTotal} friend{referralsTotal !== 1 ? 's' : ''}</p>
            </>}
          </div>
        </DrawerContent>
      </Drawer>

      {menuView && <MenuPopup key={menuView} onClose={() => setMenuView(null)} initialView={menuView} returnToPageOnBack />}
    </Layout>
  );
}
