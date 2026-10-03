import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Send, Users, CheckCircle2, Clock3 } from 'lucide-react';
import Layout from '@/components/Layout';
import Ambassador from '@/pages/Ambassador';
import { formatLargeSWAG } from '@/lib/utils';
import { showNotification } from '@/components/AppNotification';
import { useLanguage } from '@/hooks/useLanguage';

const FRIENDS_CARD_BACKGROUND = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';
const INVITE_BUTTON_BACKGROUND = 'linear-gradient(135deg, #2563eb, #3b82f6)';
const formatReward = (value: number) => Math.trunc(value).toLocaleString();
const formatWorthUsd = (value: number) => `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;

type FriendStatus = 'active' | 'pending';
type FriendTab = 'all' | FriendStatus;
type FriendsTab = 'affiliates' | 'ambassador';
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
  const name = friend.displayName || friend.username || 'Unknown';
  return (
    <article style={{ width: '100%', borderRadius: 16, overflow: 'hidden', background: '#171717', border: '1px solid rgba(255,255,255,0.04)', marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, overflow: 'hidden', background: '#2b2b2b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {friend.avatarUrl ? <img src={friend.avatarUrl} alt={name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span style={{ fontSize: 14, fontWeight: 900, color: 'rgba(255,255,255,0.7)' }}>{name.slice(0, 2).toUpperCase()}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.2, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          <p style={{ margin: '3px 0 0', fontSize: 10, lineHeight: 1.2, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{friend.username ? `@${friend.username.replace(/^@/, '')}` : 'Telegram user'}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>AdsGram Ads</p>
          <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 900, color: '#fff' }}>{friend.adsWatched.toLocaleString()}</p>
        </div>
      </div>
      <div style={{ padding: '0 12px 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <p style={{ margin: '0 0 3px', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Joined</p>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.78)' }}>{formatJoinDate(friend.createdAt)}</p>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '5px 9px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: isActive ? '#86efac' : '#fcd34d', background: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)' }}>
          {isActive ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}{isActive ? 'Active' : 'Pending'}
        </span>
      </div>
    </article>
  );
}

export default function Affiliates() {
  const { t } = useLanguage();
  const [isSharing, setIsSharing] = useState(false);
  const [activeTab, setActiveTab] = useState<FriendsTab>(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'ambassador'
      ? 'ambassador'
      : 'affiliates'
  ));
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
  const joinReward = Math.max(0, Number(appSettings?.referralJoinRewardGold ?? 500) || 0);
  const activeReward = Math.max(0, Number(appSettings?.referralActiveRewardGold ?? 2000) || 0);
  const referralAdsRequired = Math.max(0, Number(appSettings?.referralAdsRequired ?? 15) || 0);
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
      <main className="max-w-md mx-auto min-h-full px-3 pt-3 bg-black pb-[88px] text-white">
        <div className="px-1 mb-3">
          <h1 className="m-0 text-xl font-black text-white">Friends</h1>
          <p className="m-0 mt-1 text-xs text-white/45">Invite your network to grow your GEM earnings.</p>
        </div>

        <div style={{ margin: '0 0 12px', padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }} role="tablist" aria-label="Friends sections">
          <button type="button" role="tab" aria-selected={activeTab === 'affiliates'} onClick={() => setActiveTab('affiliates')} style={{ border: 0, borderRadius: 11, padding: '10px 8px', background: activeTab === 'affiliates' ? INVITE_BUTTON_BACKGROUND : 'transparent', color: activeTab === 'affiliates' ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>Affiliates</button>
          <button type="button" role="tab" aria-selected={activeTab === 'ambassador'} onClick={() => setActiveTab('ambassador')} style={{ border: 0, borderRadius: 11, padding: '10px 8px', background: activeTab === 'ambassador' ? INVITE_BUTTON_BACKGROUND : 'transparent', color: activeTab === 'ambassador' ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>Ambassador</button>
        </div>

        {activeTab === 'ambassador' ? (
          <Ambassador embedded />
        ) : (
          <>
            <section className="rounded-[16px] p-3 mb-3 overflow-hidden" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
              <div className="text-white text-[15px] font-black mb-3">Per friend you invite</div>
              <div className="rounded-xl p-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.045)' }}><div className="flex items-center justify-between gap-3 min-w-0"><div className="flex items-center gap-2 min-w-0"><img src="/assets/gems-icon.svg" alt="GEM" className="w-7 h-7 object-contain shrink-0" /><div className="flex items-baseline gap-2 min-w-0"><span className="text-white text-xl font-black tabular-nums truncate">{settingsLoaded ? formatReward(totalReward) : '…'}</span><span className="text-white text-xs font-extrabold uppercase tracking-wider shrink-0">GEM</span></div></div><div className="text-right shrink-0"><div className="text-white/45 text-[10px] font-bold uppercase tracking-wider">Worth</div><div className="text-white text-sm font-black whitespace-nowrap">{settingsLoaded ? formatWorthUsd(worthUsd) : '…'}</div></div></div><div className="grid grid-cols-3 gap-1 mt-3">{[['On join', settingsLoaded ? `+${formatReward(joinReward)} GEM` : '…'], ['When active', settingsLoaded ? `+${formatReward(activeReward)} GEM` : '…'], ['Forever', settingsLoaded ? `${commissionPercent}% Commission` : '…']].map(([label, value]) => <div key={label} className="rounded-xl px-1.5 py-2 min-w-0" style={{ background: 'rgba(0,0,0,0.28)' }}><div className="text-white/45 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">{label}</div><div className="text-white text-xs font-black mt-1 whitespace-nowrap tabular-nums">{value}</div></div>)}</div></div>
            </section>
            <section className="rounded-[14px] p-2 mb-3" style={{ background: FRIENDS_CARD_BACKGROUND, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}><div className="grid grid-cols-3 gap-2">{[['Friends', totalFriends], ['Active', activeFriends], ['Earned GEM', formatLargeSWAG(totalEarned, false)]].map(([label, value]) => <div key={String(label)} className="text-center rounded-lg py-2" style={{ background: 'rgba(255,255,255,0.045)' }}><div className="text-white text-sm font-black tabular-nums truncate">{value}</div><div className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-1 truncate">{label}</div></div>)}</div></section>
            <div className="flex items-center gap-2 mb-4"><button onClick={inviteFriends} disabled={isSharing || !referralLink} className="flex-1 h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }}><Send className="w-4 h-4 text-white" /><span className="text-white font-bold text-xs">{isSharing ? 'Opening…' : 'Invite Friends'}</span></button><button onClick={copyLink} disabled={!referralLink} className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0" style={{ background: INVITE_BUTTON_BACKGROUND, boxShadow: '0 8px 22px rgba(37,99,235,0.22)' }} title="Copy referral link" aria-label="Copy referral link"><Copy className="w-4 h-4 text-white" /></button></div>

            <div className="px-1 mb-3"><h2 className="m-0 text-base font-black text-white">Your Friends</h2><p className="m-0 mt-1 text-[10px] text-white/40">A friend becomes active after watching {referralAdsRequired} AdsGram ads. Other ad providers do not count.</p></div>
            <div style={{ margin: '0 0 10px', padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }} role="tablist" aria-label="Friend status filters">
              {([['all', 'All'], ['active', 'Active'], ['pending', 'Pending']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={friendTab === id} onClick={() => setFriendTab(id)} style={{ border: 0, borderRadius: 11, padding: '10px 8px', background: friendTab === id ? INVITE_BUTTON_BACKGROUND : 'transparent', color: friendTab === id ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>{label}</button>)}
            </div>
            {referralsLoading ? <div className="py-8 text-center text-xs text-white/40">Loading friends…</div> : visibleFriends.length === 0 ? <div className="py-8 text-center"><Users className="mx-auto mb-2 text-white/20" size={25} /><p className="m-0 text-xs text-white/40">No {friendTab === 'all' ? '' : friendTab} friends yet.</p></div> : <div className="flex flex-col gap-2">{visibleFriends.map((friend) => <FriendCard key={friend.id} friend={friend} />)}</div>}
          </>
        )}
      </main>
    </Layout>
  );
}
