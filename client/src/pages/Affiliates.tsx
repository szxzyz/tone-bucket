import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import { Copy, Users, Send, Gift, CheckCircle2, Clock3 } from 'lucide-react';
import { formatLargeSWAG } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { useLanguage } from '@/hooks/useLanguage';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';

const formatUsd = (value: number) => `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;

export default function Affiliates() {
  const { t } = useLanguage();
  const [referralsOpen, setReferralsOpen] = useState(false);
  const [visibleReferralsCount, setVisibleReferralsCount] = useState(40);
  const [isSharing, setIsSharing] = useState(false);
  const queryClient = useQueryClient();
  const preparedShareRef = useRef<Promise<any> | null>(null);

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const { data: myReferralsData, isLoading: isLoadingReferrals } = useQuery<any>({
    queryKey: ['/api/referrals/my-referrals'], retry: false, enabled: referralsOpen,
  });
  const { data: botInfo } = useQuery<{ username: string }>({
    queryKey: ['/api/bot-info'], retry: false, staleTime: 5 * 60 * 1000,
  });

  const botUsername = botInfo?.username || '';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`
    : '';
  const settingsLoaded = appSettings !== undefined;
  const goldReward = appSettings?.referralRewardGemsEnabled ? Number(appSettings.referralRewardGems || 0) : 0;
  const joinRewardUsd = appSettings?.referralRewardUSDEnabled ? Number(appSettings.referralRewardUSD || 0) : 0;
  const padPerUsd = Number(appSettings?.padPerUsd || 0);
  const goldWorthUsd = padPerUsd > 0 ? goldReward / padPerUsd : 0;
  const adsRequired = Number(appSettings?.referralAdsRequired || 0);
  const commissionPercent = Number(appSettings?.l1CommissionPercent || 0);

  const totalFriends = Number(stats?.totalInvites || 0);
  const activeFriends = Number(stats?.successfulInvites || 0);
  const totalEarned = Number(stats?.totalReferralBonusEarned || stats?.totalL1Earned || 0);
  const pendingBonus = Number(stats?.availableBonus || 0);
  const myReferrals: any[] = myReferralsData?.referrals || [];
  const visibleReferrals = myReferrals.slice(0, visibleReferralsCount);

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

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 pt-2 bg-black pb-0">
        <section className="rounded-[16px] p-3 mb-3 overflow-hidden" style={{ background: 'linear-gradient(145deg, #202020 0%, #101010 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,190,54,0.14)' }}>
              <Gift className="w-4 h-4 text-amber-300" />
            </div>
            <div>
              <div className="text-white text-[15px] font-black">Per friend you invite</div>
              <div className="text-white/40 text-[10px] mt-0.5">Rewards are controlled by admin settings</div>
            </div>
          </div>
          <div className="rounded-xl p-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)' }}>
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <img src="/assets/gems-icon.svg" alt="Gold" className="w-8 h-8 object-contain" />
                <div>
                  <div className="text-white text-base font-black tabular-nums truncate">{settingsLoaded ? formatLargeSWAG(goldReward, false) : '…'}</div>
                  <div className="text-amber-200/70 text-[9px] font-bold uppercase tracking-wider">Gold</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider">Worth</div>
                <div className="text-white text-sm font-black whitespace-nowrap">{settingsLoaded && padPerUsd > 0 ? formatUsd(goldWorthUsd) : '—'}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-xl px-2.5 py-2" style={{ background: 'rgba(0,0,0,0.24)' }}>
                <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider">On join</div>
                <div className="text-white text-xs font-black mt-1 truncate">{settingsLoaded ? `+${formatUsd(joinRewardUsd)}` : '…'}</div>
              </div>
              <div className="rounded-xl px-2.5 py-2" style={{ background: 'rgba(0,0,0,0.24)' }}>
                <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider">When active</div>
                <div className="text-white text-xs font-black mt-1 truncate">{settingsLoaded ? `+${formatLargeSWAG(goldReward, false)} Gold` : '…'}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 mt-3 text-white/70 text-[10px] font-bold">
            <span className="text-[#39ff14]">{settingsLoaded ? `${commissionPercent}% forever` : '…'}</span>
            <span className="text-white/25">•</span>
            <span>{settingsLoaded && adsRequired > 0 ? `${adsRequired} ads to activate` : 'Activation requirement'}</span>
          </div>
        </section>

        <section className="rounded-[14px] p-2 mb-3" style={{ background: '#171717', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Friends', totalFriends],
              ['Active', activeFriends],
              ['Earned', formatLargeSWAG(totalEarned, false)],
            ].map(([label, value]) => (
              <div key={String(label)} className="text-center rounded-lg py-2" style={{ background: 'rgba(255,255,255,0.045)' }}>
                <div className="text-white text-sm font-black tabular-nums truncate">{value}</div>
                <div className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-1">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={inviteFriends} disabled={isSharing || !referralLink} className="flex-1 h-11 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50" style={{ background: '#252525' }}>
            <Send className="w-4 h-4 text-white" />
            <span className="text-white font-bold text-xs">{isSharing ? 'Opening…' : 'Invite Friends'}</span>
          </button>
          <button onClick={copyLink} disabled={!referralLink} className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0" style={{ background: '#252525' }} title="Copy referral link">
            <Copy className="w-4 h-4 text-white" />
          </button>
        </div>

        <button onClick={() => setReferralsOpen(true)} className="w-full h-10 rounded-xl mb-3 flex items-center justify-center gap-2 text-white text-xs font-extrabold" style={{ background: '#202020', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Users className="w-4 h-4" /> My invites
        </button>

        {pendingBonus > 0 && (
          <section className="rounded-xl p-3 mb-4" style={{ background: '#151515', border: '1px solid rgba(57,255,20,0.14)' }}>
            <div className="flex items-center justify-between mb-3">
              <div><div className="text-white/40 text-[10px] font-bold uppercase tracking-wider">Ready to collect</div><div className="text-white text-lg font-black mt-1">{formatLargeSWAG(pendingBonus, false)} Gold</div></div>
              <button onClick={() => claimReferralMutation.mutate()} disabled={claimReferralMutation.isPending} className="h-9 px-3 rounded-lg text-[10px] font-black text-black disabled:opacity-50" style={{ background: '#39ff14' }}>{claimReferralMutation.isPending ? 'Collecting…' : 'Collect'}</button>
            </div>
          </section>
        )}

        <section className="rounded-[16px] p-3 mb-3" style={{ background: '#151515', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-white text-sm font-black mb-3">How it works</div>
          {[
            ['They join', `Friend opens the app from your link${joinRewardUsd > 0 ? ` · +${formatUsd(joinRewardUsd)}` : ''}`],
            ['They watch', `${adsRequired > 0 ? adsRequired : 'the required number of'} ads to become active${goldReward > 0 ? ` · +${formatLargeSWAG(goldReward, false)} Gold` : ''}`],
            ['Forever after', `${commissionPercent}% of everything they earn, for life`],
          ].map(([title, text], index) => (
            <div key={title} className="flex gap-2 items-start py-2 border-b border-white/[0.06] last:border-0 last:pb-0">
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black" style={{ background: index === 2 ? 'rgba(57,255,20,0.14)' : 'rgba(255,255,255,0.08)', color: index === 2 ? '#39ff14' : '#fff' }}>{index + 1}</div>
              <div><div className="text-white text-xs font-extrabold">{title}</div><div className="text-white/45 text-[10px] leading-relaxed mt-1">{text}</div></div>
            </div>
          ))}
        </section>

        <div style={{ height: 104, flexShrink: 0 }} />
      </main>

      <Drawer open={referralsOpen} onOpenChange={(open) => { setReferralsOpen(open); if (!open) setVisibleReferralsCount(40); }}>
        <DrawerContent className="bg-[#111] border-none max-h-[80vh]">
          <DrawerHeader className="flex items-center justify-between pb-2"><DrawerTitle className="text-white font-bold text-lg">My invites</DrawerTitle><DrawerClose asChild><button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10">Close</button></DrawerClose></DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {isLoadingReferrals ? <div className="text-white/40 text-sm text-center py-10">Loading…</div> : myReferrals.length === 0 ? <div className="flex flex-col items-center py-10 gap-2"><Users className="w-10 h-10 text-white/20" /><p className="text-white/40 text-sm">No invites yet</p></div> : <>
              <div className="grid grid-cols-2 gap-2 pb-2 border-b border-white/10 mb-2"><span className="text-[#888] text-xs font-semibold uppercase tracking-wider">Friend</span><span className="text-[#888] text-xs font-semibold uppercase tracking-wider text-right">Status</span></div>
              <div className="space-y-2">{visibleReferrals.map((ref: any) => <div key={ref.id} className="grid grid-cols-2 gap-2 items-center py-2 border-b border-white/5"><div className="min-w-0"><p className="text-white text-sm font-medium truncate">{ref.username ? `@${ref.username}` : ref.displayName}</p>{ref.username && ref.displayName && ref.displayName !== ref.username && <p className="text-[#888] text-xs truncate">{ref.displayName}</p>}</div><div className="flex justify-end">{ref.status === 'success' ? <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[11px] px-2"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge> : <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[11px] px-2"><Clock3 className="w-3 h-3 mr-1" />Pending</Badge>}</div></div>)}</div>
              {visibleReferrals.length < myReferrals.length && <button onClick={() => setVisibleReferralsCount((count) => count + 40)} className="w-full mt-3 py-2 rounded-lg text-xs font-medium text-white/70 bg-white/5">Load more</button>}
              <p className="text-[#666] text-xs mt-4 text-center">{myReferrals.length} invite{myReferrals.length !== 1 ? 's' : ''}</p>
            </>}
          </div>
        </DrawerContent>
      </Drawer>
    </Layout>
  );
}
