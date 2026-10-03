import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { FaStar, FaSync } from 'react-icons/fa';
import Layout from '@/components/Layout';
import ReferralContestSection from '@/components/ReferralContestSection';

interface MonthlyEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  weeklyStars: number;
  avatarUrl?: string | null;
  rank: number;
}

interface WeeklyLeaderboardData {
  leaderboard: MonthlyEntry[];
  userRank: { rank: number; weeklyStars: number } | null;
  userGold: number;
  userStars: number;
  contestActive: boolean;
  topN: number;
  prizes: string[];
  startDate: string | null;
  endDate: string | null;
}

const FIXED_REWARDS = [500000, 250000, 100000, 50000, 50000, 1000, 1000, 1000, 1000, 1000];
const MEDALS = ['🥇', '🥈', '🥉'];

function rankLabel(rank: number) {
  return rank <= 3 ? MEDALS[rank - 1] : `#${rank}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function useCountdown(target: Date | null) {
  const [time, setTime] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    if (!target) return;
    const update = () => {
      const remaining = target.getTime() - Date.now();
      if (remaining <= 0) return setTime({ d: 0, h: 0, m: 0, s: 0 });
      setTime({
        d: Math.floor(remaining / 86400000),
        h: Math.floor((remaining % 86400000) / 3600000),
        m: Math.floor((remaining % 3600000) / 60000),
        s: Math.floor((remaining % 60000) / 1000),
      });
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  return time;
}

function WeeklyParticipant({ rank, entry, score, currentUserId, prize }: {
  rank: number;
  entry: MonthlyEntry | null;
  score: number;
  currentUserId?: string | number;
  prize: number;
}) {
  const name = entry ? entry.firstName || entry.username || `User ${rank}` : '—';
  const username = entry?.username ? `@${entry.username.replace(/^@/, '')}` : '@username';
  const isMe = !!entry && String(entry.userId) === String(currentUserId);

  return (
    <div style={{ width: '100%', borderRadius: 16, overflow: 'hidden', background: '#171717', border: isMe ? '1px solid rgba(59,130,246,0.6)' : 'none', marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, overflow: 'hidden', background: '#2b2b2b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {entry?.avatarUrl ? <img src={entry.avatarUrl} alt={name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span style={{ fontSize: 14, fontWeight: 900, color: 'rgba(255,255,255,0.7)' }}>{entry ? name.slice(0, 2).toUpperCase() : '—'}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.2, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}{isMe && <span style={{ marginLeft: 5, fontSize: 9, color: '#6b21a8' }}>You</span>}</p>
          <p style={{ margin: '3px 0 0', fontSize: 10, lineHeight: 1.2, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry ? username : '@username'}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Rank</p>
          <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 900, color: '#fff' }}>{entry ? `#${rank}` : '—'}</p>
        </div>
      </div>
      <div style={{ padding: '0 12px 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <p style={{ margin: '0 0 3px', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Total Stars:</p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FaStar style={{ color: '#facc15', fontSize: 16 }} /><span style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{entry ? score.toLocaleString() : '—'}</span></span>
        </div>
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <p style={{ margin: '0 0 3px', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Reward</p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><img src="/assets/gems-icon.svg" alt="GEM" style={{ width: 20, height: 20, objectFit: 'contain' }} /><span style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{entry ? prize.toLocaleString() : '—'}</span></span>
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<'ad' | 'ref'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('contest') === 'ref' || params.get('section') === 'referral-contest' ? 'ref' : 'ad';
  });
  const { data: appSettings } = useQuery<any>({ queryKey: ['/api/app-settings'], staleTime: 0, refetchInterval: 15000 });
  const { data, isLoading, isError, refetch, isFetching } = useQuery<WeeklyLeaderboardData>({
    queryKey: ['/api/leaderboard/weekly', 'current'],
    queryFn: async () => {
      const response = await fetch('/api/leaderboard/weekly', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load weekly leaderboard');
      return response.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
  });

  const contestActive = data?.contestActive !== false;
  const topN = Math.max(1, Math.min(50, Number(data?.topN ?? appSettings?.monthlyContestTopUsers) || 10));
  const entriesByRank = useMemo(() => new Map((data?.leaderboard || []).map((entry) => [entry.rank, entry])), [data?.leaderboard]);
  const startDateLabel = formatDate(data?.startDate || appSettings?.monthlyContestStartDate);
  const endDateValue = data?.endDate || appSettings?.monthlyContestEndDate || null;
  const endDateLabel = formatDate(endDateValue);
  const endDate = useMemo(() => {
    if (!endDateValue) return null;
    const date = new Date(endDateValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [endDateValue]);
  const countdown = useCountdown(endDate);
  const userRank = contestActive ? data?.userRank : null;
  const hasData = (data?.leaderboard || []).length > 0;
  const rewardForRank = (rank: number) => data?.prizes?.[rank - 1] || `${(FIXED_REWARDS[rank - 1] || 0).toLocaleString()} GEM`;

  return (
    <Layout>
      <div style={{ background: '#0a0a0a', minHeight: '100%' }}>
        <div style={{ margin: '12px 12px 0', padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }} role="tablist" aria-label="Leaderboard contests">
          {([['ad', 'Ad Contest'], ['ref', 'Ref Contest']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} style={{ border: 0, borderRadius: 11, padding: '10px 8px', background: activeTab === id ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'transparent', color: activeTab === id ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        {activeTab === 'ad' ? <>
        <section style={{ margin: '12px 12px 0', padding: 12, borderRadius: 18, background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)', boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/assets/gems-icon.svg" alt="GEM" style={{ width: 30, height: 30, objectFit: 'contain' }} />
              <div><h1 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#fff' }}>Ad Watch Contest</h1><p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Watch ads, earn stars and rank up.</p></div>
            </div>
            <button type="button" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh ad watch contest" style={{ width: 34, height: 34, flexShrink: 0, border: 0, borderRadius: 10, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', display: 'grid', placeItems: 'center' }}><FaSync style={{ fontSize: 12, animation: isFetching ? 'spin 1s linear infinite' : undefined }} /></button>
          </div>
        </section>
        <div style={{ margin: '14px 16px 0', background: 'rgba(255,255,255,0.045)', borderRadius: 18, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            ['Your Rank', userRank ? rankLabel(userRank.rank) : '—'],
            ['Ads Watched', (data?.userStars || userRank?.weeklyStars || 0).toLocaleString()],
            ['Potential Rewards', userRank ? rewardForRank(userRank.rank) : '—'],
          ].map(([label, value]) => <div key={label} style={{ minWidth: 0 }}><p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p><p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 900, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p></div>)}
        </div>

        {(startDateLabel || endDateLabel) && <div style={{ margin: '14px 16px 0', background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)', borderRadius: 18, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Started</p><p style={{ margin: '3px 0 0', fontSize: 13, fontWeight: 800, color: '#fff' }}>{startDateLabel || '—'}</p></div>
            <div style={{ textAlign: 'right' }}><p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Ends</p><p style={{ margin: '3px 0 0', fontSize: 13, fontWeight: 800, color: '#fff' }}>{endDateLabel || '—'}</p></div>
          </div>
          {endDate && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}><span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Time left:</span><span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{countdown.d}d {countdown.h}h {countdown.m}m {countdown.s}s</span></div>}
        </div>}

        {isLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div style={{ display: 'flex', gap: 6 }}>{[0, 150, 300].map((delay) => <div key={delay} style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', animation: `pulse 1s ${delay}ms infinite` }} />)}</div></div>
          : isError ? <div style={{ textAlign: 'center', padding: '48px 24px', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Unable to load leaderboard. Tap refresh to try again.</div>
            : !contestActive ? <div style={{ textAlign: 'center', padding: '48px 24px' }}><div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div><p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.45)', margin: '0 0 8px' }}>Contest Not Active</p><p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: 0 }}>Admin will start the next Weekly Contest soon.</p></div>
              : <>
                <div style={{ padding: '16px 16px 0' }}>
                  {Array.from({ length: topN }, (_, index) => index + 1).map((rank) => <WeeklyParticipant key={rank} rank={rank} entry={entriesByRank.get(rank) || null} score={entriesByRank.get(rank)?.weeklyStars ?? 0} currentUserId={user?.id} prize={FIXED_REWARDS[rank - 1] || 0} />)}
                  <button onClick={() => void refetch()} disabled={isFetching} style={{ display: 'block', margin: '2px auto 0', padding: '6px 12px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer' }}><FaSync style={{ marginRight: 5, fontSize: 10, animation: isFetching ? 'spin 1s linear infinite' : undefined }} />Refresh</button>
                </div>
                {!hasData && <div style={{ textAlign: 'center', padding: '12px 24px 0' }}><p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', margin: 0 }}>Watch ads to earn stars and climb!</p></div>}
              </>}
        <div style={{ height: 24 }} />
        </> : <ReferralContestSection />}
      </div>
    </Layout>
  );
}
