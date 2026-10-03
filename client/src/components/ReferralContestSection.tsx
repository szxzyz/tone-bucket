import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FaSync } from 'react-icons/fa';
import { useAuth } from '@/hooks/useAuth';
import { CONTEST_PRIZE_AMOUNTS } from '@shared/constants';

interface ReferralEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  avatarUrl?: string | null;
  referralCount: number;
  rank: number;
}

interface ReferralContestData {
  leaderboard: ReferralEntry[];
  userRank: { rank: number; referralCount: number } | null;
  contestActive: boolean;
  topN: number;
  prizes: string[];
  startDate: string | null;
  endDate: string | null;
}

const MEDALS = ['🥇', '🥈', '🥉'];
const SURFACE = 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)';

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

function ReferralParticipant({ rank, entry, prize, currentUserId }: {
  rank: number;
  entry: ReferralEntry | null;
  prize: string;
  currentUserId?: string | number;
}) {
  const name = entry?.firstName || entry?.username || `User ${rank}`;
  const username = entry?.username ? `@${entry.username.replace(/^@/, '')}` : '@username';
  const isMe = !!entry && String(entry.userId) === String(currentUserId);
  const referralCount = entry?.referralCount ?? 0;

  return (
    <article style={{ width: '100%', borderRadius: 16, overflow: 'hidden', background: '#171717', marginBottom: 0, border: isMe ? '1px solid rgba(59,130,246,0.6)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px' }}>
        <div style={{ width: 39, height: 39, borderRadius: 11, flexShrink: 0, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {entry?.avatarUrl ? <img src={entry.avatarUrl} alt={name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span style={{ fontSize: 13, fontWeight: 900, color: 'rgba(255,255,255,0.75)' }}>{entry ? name.slice(0, 2).toUpperCase() : '—'}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.2, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry ? name : '—'}{isMe && <span style={{ marginLeft: 5, fontSize: 9, color: '#60a5fa' }}>You</span>}</p>
          <p style={{ margin: '3px 0 0', fontSize: 10, lineHeight: 1.2, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry ? username : '—'}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Invites</p>
          <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 900, color: '#fff' }}>{entry ? referralCount.toLocaleString() : '—'}</p>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px 11px' }}>
        <span style={{ color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Rank {rankLabel(rank)}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><img src="/assets/gems-icon.svg" alt="GEM" style={{ width: 18, height: 18, objectFit: 'contain' }} /><span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{entry ? prize : '—'}</span></span>
      </div>
    </article>
  );
}

export default function ReferralContestSection({ highlighted = false }: { highlighted?: boolean }) {
  const { user } = useAuth() as any;
  const { data, isLoading, isError, refetch, isFetching } = useQuery<ReferralContestData>({
    queryKey: ['/api/leaderboard/referral'],
    queryFn: async () => {
      const response = await fetch('/api/leaderboard/referral', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load referral contest');
      return response.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
  });

  const endDate = useMemo(() => {
    if (!data?.endDate) return null;
    const date = new Date(data.endDate);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [data?.endDate]);
  const countdown = useCountdown(endDate);
  const startDateLabel = formatDate(data?.startDate);
  const endDateLabel = formatDate(data?.endDate);
  const topN = Math.max(1, Math.min(50, Number(data?.topN) || 10));
  const entriesByRank = new Map((data?.leaderboard || []).map((entry) => [entry.rank, entry]));
  const userRank = data?.userRank && data.contestActive ? data.userRank : null;
  const prizeAt = (rank: number) => data?.prizes?.[rank - 1] || `${(CONTEST_PRIZE_AMOUNTS[rank - 1] || 0).toLocaleString()} GEM`;
  const showPlayerList = !isLoading && !isError && !!data?.contestActive;

  return (
    <div id="referral-contest" style={{ margin: '12px 16px 0', borderRadius: 20, scrollMarginTop: 'calc(var(--header-height, 56px) + 16px)', transition: 'box-shadow 250ms ease', boxShadow: highlighted ? '0 0 0 3px rgba(59,130,246,0.95), 0 0 26px rgba(37,99,235,0.55)' : 'none' }}>
      <section aria-label="Referral Contest overview" style={{ padding: 12, borderRadius: 18, background: SURFACE, boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#fff' }}>Referral Contest</h2>
          </div>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh referral contest" style={{ width: 34, height: 34, flexShrink: 0, border: 0, borderRadius: 10, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', display: 'grid', placeItems: 'center' }}>
            <FaSync style={{ fontSize: 12, animation: isFetching ? 'spin 1s linear infinite' : undefined }} />
          </button>
        </div>

        {(startDateLabel || endDateLabel) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: endDate ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
            <div><p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase' }}>Started</p><p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 800, color: '#fff' }}>{startDateLabel || '—'}</p></div>
            <div style={{ textAlign: 'right' }}><p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase' }}>Ends</p><p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 800, color: '#fff' }}>{endDateLabel || '—'}</p></div>
          </div>
        )}
        {endDate && <div style={{ textAlign: 'center', padding: '8px 0 2px', color: 'rgba(255,255,255,0.48)', fontSize: 11 }}>Time left: <strong style={{ color: '#fff', fontSize: 12 }}>{countdown.d}d {countdown.h}h {countdown.m}m {countdown.s}s</strong></div>}

        {isLoading ? <div style={{ padding: '20px 0 8px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Loading referral contest…</div>
          : isError ? <div style={{ padding: '20px 6px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Unable to load the referral contest. Tap refresh to try again.</div>
            : !data?.contestActive ? <div style={{ padding: '20px 6px 8px', textAlign: 'center' }}><div style={{ fontSize: 34, marginBottom: 8 }}>🔒</div><p style={{ margin: '0 0 5px', color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: 800 }}>Contest Not Active</p><p style={{ margin: 0, color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>Admin will start the next Referral Contest soon.</p></div>
              : <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: 'rgba(255,255,255,0.045)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
                {[
                  ['Your Rank', userRank ? rankLabel(userRank.rank) : '—'],
                  ['Friends Invited', (userRank?.referralCount ?? 0).toLocaleString()],
                  ['Potential Reward', userRank ? prizeAt(userRank.rank) : '—'],
                ].map(([label, value]) => <div key={label} style={{ minWidth: 0 }}><p style={{ margin: 0, fontSize: 8, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p><p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 900, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p></div>)}
              </div>}
      </section>

      {showPlayerList && <div aria-label="Referral contest rankings" style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
        {Array.from({ length: topN }, (_, index) => index + 1).map((rank) => <ReferralParticipant key={rank} rank={rank} entry={entriesByRank.get(rank) || null} prize={prizeAt(rank)} currentUserId={user?.id} />)}
        {!data?.leaderboard?.length && <p style={{ margin: '2px 0 0', textAlign: 'center', color: 'rgba(255,255,255,0.38)', fontSize: 11 }}>Invite friends who complete the requirement to rank up!</p>}
      </div>}
    </div>
  );
}
