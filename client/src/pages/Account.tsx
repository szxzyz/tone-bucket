import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import MenuPopup from '@/components/GameMenuPopup';
import { Copy, Users, CheckCircle2, Clock3, User, UserPlus, Receipt, ChevronRight, Shield } from 'lucide-react';
import { RiBarChartFill } from 'react-icons/ri';
import { BsQuestionCircleFill } from 'react-icons/bs';
import { MdOutlineSupportAgent } from 'react-icons/md';
import { useLanguage } from '@/hooks/useLanguage';
import { useAdmin } from '@/hooks/useAdmin';
import { useSupportLink } from '@/hooks/useSupportLink';
import { useLocation } from 'wouter';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';

type AccountMenuView = 'transactions' | 'stats' | 'faq' | 'legal';
const ACCOUNT_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';
const INVITE_BUTTON_BACKGROUND = 'linear-gradient(135deg, #2563eb, #3b82f6)';

export default function Account() {
  const { t } = useLanguage();
  const { isAdmin } = useAdmin();
  const supportLink = useSupportLink();
  const [, setLocation] = useLocation();
  const [referralsOpen, setReferralsOpen] = useState(false);
  const [referralsPage, setReferralsPage] = useState(1);
  const [menuView, setMenuView] = useState<AccountMenuView | null>(null);

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<{ username: string }>({
    queryKey: ['/api/bot-info'], retry: false, staleTime: 5 * 60 * 1000,
  });
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

  const telegramUser = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user : null;
  const profilePhoto = telegramUser?.photo_url || user?.profileImageUrl || null;
  const displayName = user?.firstName || telegramUser?.first_name || 'User';
  const username = user?.telegramUsername || telegramUser?.username || null;
  const telegramId = user?.telegramId || telegramUser?.id?.toString() || null;
  const botUsername = botInfo?.username || '';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`
    : '';
  const myReferrals: any[] = myReferralsData?.referrals || [];
  const referralsTotal = Number(myReferralsData?.total ?? myReferrals.length);
  const referralsTotalPages = Math.max(1, Number(myReferralsData?.totalPages ?? 1));

  const copyLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    showNotification(t('link_copied'), 'success');
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
        <section className="rounded-2xl p-4 mb-3" style={{ background: ACCOUNT_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <p className="text-white text-[13px] font-black uppercase tracking-widest mb-3">Account Info</p>
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

        <button onClick={copyLink} disabled={!referralLink} className="w-full h-11 rounded-xl mb-3 flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }} title="Copy referral link">
          <Copy className="w-4 h-4 text-white" />
          <span className="text-white font-bold text-xs">Copy referral link</span>
        </button>

        <section className="space-y-2 mb-3" aria-label="Account actions">
          {menuActions.map(({ label, icon, action }) => (
            <button key={label} onClick={action} className="w-full flex items-center justify-between rounded-2xl p-4 hover:brightness-110 transition-all active:scale-[0.99]" style={{ background: ACCOUNT_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
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
