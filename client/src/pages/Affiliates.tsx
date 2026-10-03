import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Send, ExternalLink, Users, CheckCircle2, Clock3 } from 'lucide-react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { formatLargeSWAG } from '@/lib/utils';
import { showNotification } from '@/components/AppNotification';
import { useLanguage } from '@/hooks/useLanguage';

const FRIENDS_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';
const INVITE_BUTTON_BACKGROUND = 'linear-gradient(135deg, #2563eb, #3b82f6)';
const formatReward = (value: number) => Math.trunc(value).toLocaleString();
const formatWorthUsd = (value: number) => `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;

type FriendStatus = 'active' | 'pending';
type FriendTab = 'all' | FriendStatus;
interface ReferralFriend {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  adsWatched: number;
  status: FriendStatus;
  createdAt: string | null;
}

function formatJoinDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function FriendCard({ friend }: { friend: ReferralFriend }) {
  const isActive = friend.status === 'active';
  return (
    <article className="rounded-2xl overflow-hidden" style={{ background: '#171717', border: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex items-center gap-3 p-3">
        <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.08)' }}>
          {friend.avatarUrl ? <img src={friend.avatarUrl} alt={friend.displayName} loading="lazy" className="w-full h-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span className="text-sm font-black text-white/75">{friend.displayName.slice(0, 2).toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-extrabold text-white truncate">{friend.displayName}</p>
          <p className="m-0 mt-1 text-[10px] text-white/40 truncate">{friend.username ? `@${friend.username.replace(/^@/, '')}` : 'Telegram user'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="m-0 text-[9px] uppercase tracking-wider font-bold text-white/35">Ads</p>
          <p className="m-0 mt-1 text-sm font-black text-white">{friend.adsWatched.toLocaleString()}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-0">
        <div>
          <p className="m-0 text-[9px] uppercase tracking-wider font-bold text-white/30">Joined</p>
          <p className="m-0 mt-1 text-[11px] font-bold text-white/75">{formatJoinDate(friend.createdAt)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {isActive ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
          {isActive ? 'Active' : 'Pending'}
        </span>
      </div>
    </article>
  );
}

export default function Affiliates() {
  const { t } = useLanguage();
  const [isSharing, setIsSharing] = useState(false);
  const [activeTab, setActiveTab] = useState<'affiliates' | 'ambassador'>('affiliates');
  const [friendTab, setFriendTab] = useState<FriendTab>('all');
  const preparedShareRef = useRef<Promise<any> | null>(null);
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 5 * 60 * 1000 });
  const { data: stats } = useQuery<any>({ queryKey: ['/api/referrals/stats'], retry: false });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], retry: false });
  const { data: referralData, isLoading: referralsLoading } = useQuery<{ referrals: ReferralFriend[] }>({
    queryKey: ['/api/referrals/my-referrals'],
    queryFn: async () => {
      const response = await fetch('/api/referrals/my-referrals', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load referrals');
      return response.json();
    },
    staleTime: 15000,
    refetchInterval: 30000,
  });
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
  const referralLink = user?.referralCode ? `https://t.me/${botInfo?.username || ''}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}` : '';
  const friends = referralData?.referrals || [];
  const visibleFriends = useMemo(() => friendTab === 'all' ? friends : friends.filter((friend) => friend.status === friendTab), [friendTab, friends]);

  const prepareShareMessage = () => {
    if (!referralLink) return Promise.resolve(null);
    if (!preparedShareRef.current) preparedShareRef.current = fetch('/api/share/prepare-message', { method: 'POST', credentials: 'include' }).then((response) => response.json()).catch(() => null);
    return preparedShareRef.current;
  };
  useEffect(() => { preparedShareRef.current = null; if (referralLink) void prepareShareMessage(); }, [referralLink]);
  const inviteFriends = async () => {
    if (isSharing || !referralLink) return;
    setIsSharing(true);
    try {
      const data = await prepareShareMessage();
      const tgWebApp = (window as any).Telegram?.WebApp;
      if (data?.success && tgWebApp?.shareMessage) tgWebApp.shareMessage(data.messageId, () => undefined);
      else {
        const fallbackUrl = data?.fallbackUrl || `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`;
        if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(fallbackUrl); else window.open(fallbackUrl, '_blank');
      }
    } finally { setIsSharing(false); }
  };
  const copyLink = async () => {
    if (!referralLink) return;
    try { await navigator.clipboard.writeText(referralLink); showNotification(t('link_copied'), 'success'); }
    catch { showNotification('Could not copy referral link', 'error'); }
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 pt-3 bg-black pb-0 text-white">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl mb-3" style={{ background: 'rgba(255,255,255,0.06)' }} role="tablist" aria-label="Friends sections">
          {([['affiliates', 'Affiliates'], ['ambassador', 'Ambassador']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} className="rounded-xl py-2.5 text-xs font-black transition-colors" style={{ background: activeTab === id ? INVITE_BUTTON_BACKGROUND : 'transparent', color: activeTab === id ? '#fff' : 'rgba(255,255,255,0.45)' }}>{label}</button>
          ))}
        </div>

        {activeTab === 'ambassador' ? (
          <section className="rounded-2xl p-5 text-center" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/15 text-purple-300"><Users size={26} /></div>
            <h2 className="m-0 text-lg font-black text-white">Ambassador Program</h2>
            <p className="mt-2 text-xs leading-relaxed text-white/45">Manage your ambassador dashboard, promo codes and channel settings.</p>
            <Link href="/ambassador" className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-black text-white" style={{ background: INVITE_BUTTON_BACKGROUND }}><ExternalLink size={15} /> Open Ambassador Page</Link>
          </section>
        ) : (
          <>
            <section className="rounded-[16px] p-3 mb-3 overflow-hidden" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
              <div className="text-white text-[15px] font-black mb-3">Per friend you invite</div>
              <div className="rounded-xl p-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.045)' }}>
                <div className="flex items-center justify-between gap-3 min-w-0"><div className="flex items-center gap-2 min-w-0"><img src="/assets/gems-icon.svg" alt="GEM" className="w-7 h-7 object-contain shrink-0" /><div className="flex items-baseline gap-2 min-w-0"><span className="text-white text-xl font-black tabular-nums truncate">{settingsLoaded ? formatReward(totalReward) : '…'}</span><span className="text-white text-xs font-extrabold uppercase tracking-wider shrink-0">GEM</span></div></div><div className="text-right shrink-0"><div className="text-white/45 text-[10px] font-bold uppercase tracking-wider">Worth</div><div className="text-white text-sm font-black whitespace-nowrap">{settingsLoaded ? formatWorthUsd(worthUsd) : '…'}</div></div></div>
                <div className="grid grid-cols-3 gap-1 mt-3">{[['On join', settingsLoaded ? `+${formatReward(joinReward)} GEM` : '…'], ['When active', settingsLoaded ? `+${formatReward(activeReward)} GEM` : '…'], ['Forever', settingsLoaded ? `${commissionPercent}% Commission` : '…']].map(([label, value]) => <div key={label} className="rounded-xl px-1.5 py-2 min-w-0" style={{ background: 'rgba(0,0,0,0.28)' }}><div className="text-white/45 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">{label}</div><div className="text-white text-xs font-black mt-1 whitespace-nowrap tabular-nums">{value}</div></div>)}</div>
              </div>
            </section>
            <section className="rounded-[14px] p-2 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}><div className="grid grid-cols-3 gap-2">{[['Friends', totalFriends], ['Active', activeFriends], ['Earned GEM', formatLargeSWAG(totalEarned, false)]].map(([label, value]) => <div key={String(label)} className="text-center rounded-lg py-2" style={{ background: 'rgba(255,255,255,0.045)' }}><div className="text-white text-sm font-black tabular-nums truncate">{value}</div><div className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-1 truncate">{label}</div></div>)}</div></section>
            <div className="flex items-center gap-2 mb-3"><button onClick={inviteFriends} disabled={isSharing || !referralLink} className="flex-1 h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }}><Send className="w-4 h-4 text-white" /><span className="text-white font-bold text-xs">{isSharing ? 'Opening…' : 'Invite Friends'}</span></button><button onClick={copyLink} disabled={!referralLink} className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }} title="Copy referral link" aria-label="Copy referral link"><Copy className="w-4 h-4 text-white" /></button></div>
            <section className="rounded-2xl p-3 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
              <div className="flex items-center justify-between mb-3"><div><h2 className="m-0 text-sm font-black text-white">Your Friends</h2><p className="m-0 mt-1 text-[10px] text-white/40">See who joined through your invite</p></div><span className="text-[10px] font-bold text-white/35">{friends.length} total</span></div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl mb-3" style={{ background: 'rgba(255,255,255,0.05)' }}>{([['all', 'All', friends.length], ['active', 'Active', friends.filter((friend) => friend.status === 'active').length], ['pending', 'Pending', friends.filter((friend) => friend.status === 'pending').length]] as const).map(([id, label, count]) => <button key={id} type="button" onClick={() => setFriendTab(id)} className="rounded-lg py-2 text-[10px] font-black" style={{ background: friendTab === id ? 'rgba(255,255,255,0.14)' : 'transparent', color: friendTab === id ? '#fff' : 'rgba(255,255,255,0.4)' }}>{label} <span className="ml-0.5 opacity-60">{count}</span></button>)}</div>
              {referralsLoading ? <div className="py-8 text-center text-xs text-white/40">Loading friends…</div> : visibleFriends.length === 0 ? <div className="py-8 text-center"><Users className="mx-auto mb-2 text-white/20" size={25} /><p className="m-0 text-xs text-white/40">No {friendTab === 'all' ? '' : friendTab} friends yet.</p></div> : <div className="flex flex-col gap-2">{visibleFriends.map((friend) => <FriendCard key={friend.id} friend={friend} />)}</div>}
            </section>
          </>
        )}
        <div style={{ height: 104, flexShrink: 0 }} />
      </main>
    </Layout>
  );
}
