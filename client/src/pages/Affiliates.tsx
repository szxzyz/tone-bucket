import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import { Copy, Users, Send } from 'lucide-react';
import { formatLargeSWAG } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { useLanguage } from '@/hooks/useLanguage';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';

function StatSkeleton() {
  return (
    <div
      style={{
        height: 24,
        width: 56,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 6,
        display: 'inline-block',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

export default function Affiliates() {
  const { t } = useLanguage();
  const [referralsOpen, setReferralsOpen] = useState(false);
  const queryClient = useQueryClient();
  const claimReferralMutation = useMutation<any, Error, number | undefined>({
    mutationFn: async (milestone?: number) => {
      const response = await apiRequest('POST', milestone ? '/api/referrals/milestones/claim' : '/api/referrals/claim', milestone ? { inviteTarget: milestone } : undefined);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Claim failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/referrals/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification('Reward claimed successfully', 'success');
    },
    onError: (error: any) => showNotification(error.message || 'Unable to claim reward', 'error'),
  });

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<any>({
    queryKey: ['/api/referrals/stats'],
    retry: false,
  });

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  const { data: myReferralsData, isLoading: isLoadingReferrals } = useQuery<any>({
    queryKey: ['/api/referrals/my-referrals'],
    retry: false,
    enabled: referralsOpen,
  });

  const [isSharing, setIsSharing] = useState(false);
  const preparedShareRef = useRef<Promise<any> | null>(null);

  const { data: botInfo } = useQuery<{ username: string }>({
    queryKey: ['/api/bot-info'],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  // Env-based config — bot username never hardcoded
  const { data: appConfig } = useQuery<any>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
    retry: false,
  });
  const botUsername = botInfo?.username || import.meta.env.VITE_BOT_USERNAME || appConfig?.botUsername || '';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`
    : '';

  const l1Percent = appSettings?.l1CommissionPercent ?? 20;
  const l2Percent = appSettings?.l2CommissionPercent ?? 4;

  const referralRewardSWAGEnabled = appSettings?.referralRewardSWAGEnabled;
  const referralRewardUSDEnabled = appSettings?.referralRewardUSDEnabled;

  const totalPowEarned: number = stats?.totalPowEarned ?? stats?.totalStarEarned ?? 0;

  // Copy referral link (was the main button, now the small circular button)
  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    showNotification(t('link_copied'), 'success');
  };

  const prepareShareMessage = () => {
    if (!referralLink) return Promise.resolve(null);
    if (!preparedShareRef.current) {
      preparedShareRef.current = fetch('/api/share/prepare-message', {
        method: 'POST',
        credentials: 'include',
      }).then((res) => res.json()).catch((error) => {
        console.error(error);
        return null;
      });
    }
    return preparedShareRef.current;
  };

  // Prepare the image message while the Affiliates page is open, so Invite Friends is immediate.
  useEffect(() => {
    preparedShareRef.current = null;
    if (referralLink) void prepareShareMessage();
  }, [referralLink]);

  const inviteFriends = async () => {
    if (isSharing || !referralLink) return;
    setIsSharing(true);
    try {
      const tgWebApp = (window as any).Telegram?.WebApp;
      const data = await prepareShareMessage();
      if (data?.success && tgWebApp?.shareMessage) {
        tgWebApp.shareMessage(data.messageId, () => undefined);
      } else {
        const fallbackUrl = data?.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`;
        if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(fallbackUrl);
        else window.open(fallbackUrl, '_blank');
      }
    } finally {
      setIsSharing(false);
    }
  };

  const l1Count = stats?.totalInvites ?? 0;
  const l2Count = stats?.l2Count ?? 0;
  const l1Income = Number(stats?.totalL1Earned ?? totalPowEarned);
  const l2Income = Number(stats?.totalL2Earned ?? 0);
  const rewardSWAG = appSettings?.referralRewardSWAG ?? 0;
  const powActive = referralRewardSWAGEnabled;
  const bonusLabel = powActive && rewardSWAG > 0 ? <>{rewardSWAG} <img src="/assets/gem-icon.png" style={{ width: 14, height: 14, display: 'inline-block', verticalAlign: 'middle' }} /></> : null;

  const myReferrals: any[] = myReferralsData?.referrals ?? [];

  // Render referrals in pages of 40 instead of dumping the whole list into
  // the DOM at once — power users can accumulate hundreds/thousands of
  // referrals, and unbounded rows there was a real scroll-jank risk.
  const REFERRALS_PAGE_SIZE = 40;
  const [visibleReferralsCount, setVisibleReferralsCount] = useState(REFERRALS_PAGE_SIZE);
  const visibleReferrals = myReferrals.slice(0, visibleReferralsCount);
  const hasMoreReferrals = visibleReferralsCount < myReferrals.length;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 bg-black pb-0">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white tracking-tight mb-2">
            {t('affiliates_program')}
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            {t('we_pay_out')}{' '}
            <span className="text-white font-semibold">{l1Percent}%</span>{' '}
            {t('from_l1_income')}{' '}
            <span className="text-white font-semibold">{l2Percent}%</span>{' '}
            {t('from_l2_income')}
          </p>
        </div>

        {/* Main: Invite Friends button + Copy circular button */}
        <div className="mb-4 flex items-center gap-3">
          {/* PRIMARY: Invite Friends — opens Telegram share sheet */}
          <button
            onClick={inviteFriends}
            disabled={isSharing || !user?.referralCode}
            className="flex-1 h-14 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: '#252525' }}
          >
            <Send className="w-5 h-5 text-white" />
            <span className="text-white font-bold tracking-widest text-sm">Invite Friends</span>
          </button>

          {/* SECONDARY: Copy referral link — circular icon */}
          <button
            onClick={copyLink}
            disabled={!user?.referralCode}
            className="w-14 h-14 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0"
            style={{ background: '#252525' }}
            title="Copy referral link"
          >
            <Copy className="w-5 h-5 text-white" />
          </button>
        </div>

                {/* Income from friends */}
        <div className="text-white text-[11px] font-bold uppercase tracking-[0.12em] mb-2 px-1">Income from friends</div>
        {[{ level: 1, income: l1Income, count: l1Count, percent: l1Percent }, { level: 2, income: l2Income, count: l2Count, percent: l2Percent }].map(({ level, income, count, percent }) => (
          <div key={level} className="w-full rounded-[14px] mb-2 overflow-hidden" style={{ background: '#252525' }}>
            <div className="flex items-center justify-between px-3 pt-3">
              <div className="min-w-0">
                <div className="text-white text-[15px] font-extrabold">Income to collect</div>
                <div className="text-white/40 text-xs mt-1">Level {level} · {percent}% from friends</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-white/30 text-[9px] font-bold uppercase tracking-[0.1em] mb-0.5">Friends</div>
                <div className="text-white text-[13px] font-extrabold">{count}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 pb-3 pt-2">
              <div className="flex-1 inline-flex items-center gap-1 text-white text-base font-black"><img src="/assets/gem-icon.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />{formatLargeSWAG(income, false)}</div>
              <button onClick={() => claimReferralMutation.mutate(undefined)} disabled={claimReferralMutation.isPending || Number(stats?.availableBonus || 0) <= 0} className="w-[92px] h-[38px] rounded-xl text-white text-xs font-bold border-none transition-opacity disabled:opacity-100" style={{ background: Number(stats?.availableBonus || 0) > 0 ? '#252525' : 'rgba(255,255,255,0.06)', color: Number(stats?.availableBonus || 0) > 0 ? '#fff' : 'rgba(255,255,255,0.3)' }}>{claimReferralMutation.isPending ? '...' : 'Collect'}</button>
            </div>
          </div>
        ))}

        {/* Bottom clearance for the 88px floating nav so the last card is never covered */}
        <div style={{ height: 104, flexShrink: 0 }} />
      </main>

      {/* My Referrals Bottom Drawer */}
      <Drawer
        open={referralsOpen}
        onOpenChange={(open) => {
          setReferralsOpen(open);
          if (!open) setVisibleReferralsCount(REFERRALS_PAGE_SIZE);
        }}
      >
        <DrawerContent className="bg-[#111] border-none max-h-[80vh]">
          <DrawerHeader className="flex items-center justify-between pb-2">
            <DrawerTitle className="text-white font-bold text-lg">My Referrals</DrawerTitle>
            <DrawerClose asChild>
              <button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">
                Close
              </button>
            </DrawerClose>
          </DrawerHeader>

          <div className="px-4 pb-6 overflow-y-auto">
            {isLoadingReferrals ? (
              <div className="flex items-center justify-center py-10">
                <div className="text-white/40 text-sm">Loading…</div>
              </div>
            ) : myReferrals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Users className="w-10 h-10 text-white/20" />
                <p className="text-white/40 text-sm">No referrals yet</p>
                <p className="text-white/25 text-xs">Invite friends to get started</p>
              </div>
            ) : (
              <>
                {/* Header row */}
                <div className="grid grid-cols-2 gap-2 pb-2 border-b border-white/10 mb-2">
                  <span className="text-[#888] text-xs font-semibold uppercase tracking-wider">Friend</span>
                  <span className="text-[#888] text-xs font-semibold uppercase tracking-wider text-right">Status</span>
                </div>
                {/* Referral rows */}
                <div className="space-y-2">
                  {visibleReferrals.map((ref: any) => (
                    <div key={ref.id} className="grid grid-cols-2 gap-2 items-center py-2 border-b border-white/5">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {ref.username ? `@${ref.username}` : ref.displayName}
                        </p>
                        {ref.username && ref.displayName && ref.displayName !== ref.username && (
                          <p className="text-[#888] text-xs truncate">{ref.displayName}</p>
                        )}
                      </div>
                      <div className="flex justify-end">
                        {ref.status === 'success' ? (
                          <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[11px] px-2">
                            Success
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[11px] px-2">
                            Pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {hasMoreReferrals && (
                  <button
                    onClick={() => setVisibleReferralsCount(c => c + REFERRALS_PAGE_SIZE)}
                    className="w-full mt-3 py-2 rounded-lg text-xs font-medium text-white/70 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    Load more
                  </button>
                )}
                <p className="text-[#666] text-xs mt-4 text-center">
                  {myReferrals.length} referral{myReferrals.length !== 1 ? 's' : ''}
                </p>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </Layout>
  );
}
