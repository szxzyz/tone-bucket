import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FaStar, FaSync, FaUsers } from "react-icons/fa";
import Layout from "@/components/Layout";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  weeklyStars: number;
  avatarUrl?: string | null;
  rank: number;
}

interface ReferralEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  avatarUrl?: string | null;
  referralCount: number;
  rank: number;
}

const FIXED_REWARDS = [
  { gold: 500000 },
  { gold: 250000 },
  { gold: 100000 },
  { gold: 50000 },
  { gold: 50000 },
  { gold: 1000 },
  { gold: 1000 },
  { gold: 1000 },
  { gold: 1000 },
  { gold: 1000 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉"];

function posLabel(rank: number) {
  return rank <= 3 ? MEDALS[rank - 1] : `#${rank}`;
}

function displayName(
  entry: { firstName?: string | null; username?: string | null } | null,
  rank: number
): string {
  if (!entry) return "—";
  return entry.firstName || entry.username || `User ${rank}`;
}


function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dd = new Date(d);
  if (isNaN(dd.getTime())) return null;
  return dd.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function useCountdown(target: Date | null) {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    if (!target) return;
    const calc = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) return setT({ d: 0, h: 0, m: 0, s: 0 });
      setT({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);
  return t;
}

// ─── Compact participant card matching Ad Watch ────────────────────────────────

function ParticipantCard({
  rank,
  entry,
  score,
  isMonthly,
  isMe,
}: {
  rank: number;
  entry: (MonthlyEntry | ReferralEntry) | null;
  score: number;
  isMonthly: boolean;
  isMe: boolean;
}) {
  const reward = FIXED_REWARDS[rank - 1] || { gold: 0 };
  const name = displayName(entry, rank);
  const username = entry?.username ? `@${entry.username.replace(/^@/, "")}` : "@username";
  const avatarUrl = entry?.avatarUrl || undefined;
  const metricLabel = isMonthly ? "Rank" : "Invited";
  const metricValue = isMonthly ? `#${rank}` : score.toLocaleString();

  return (
    <div style={{ width: "100%", borderRadius: 18, overflow: "hidden", background: "#171717", border: isMe ? "1px solid rgba(107,33,168,0.65)" : "none", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px" }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, overflow: "hidden", background: "#2b2b2b", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              loading="lazy"
              decoding="async"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                console.warn(`Failed to load avatar for ${name}:`, avatarUrl);
                e.currentTarget.style.display = "none";
                const parent = e.currentTarget.parentElement;
                if (parent && !parent.querySelector('.avatar-fallback')) {
                  const fallback = document.createElement('span');
                  fallback.className = 'avatar-fallback';
                  fallback.style.fontSize = '14px';
                  fallback.style.fontWeight = '900';
                  fallback.style.color = 'rgba(255,255,255,0.7)';
                  fallback.innerText = name.slice(0, 2).toUpperCase();
                  parent.appendChild(fallback);
                }
              }}
            />
          ) : <span className="avatar-fallback" style={{ fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,0.7)" }}>{name.slice(0, 2).toUpperCase()}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.2, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}{isMe && <span style={{ marginLeft: 5, fontSize: 9, color: "#6b21a8" }}>You</span>}</p>
          <p style={{ margin: "3px 0 0", fontSize: 10, lineHeight: 1.2, color: "rgba(255,255,255,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{username}</p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{metricLabel}</p>
          <p style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 900, color: "#fff" }}>{entry ? metricValue : "—"}</p>
        </div>
      </div>
      <div style={{ padding: "0 12px 12px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        {isMonthly && (
          <div>
            <p style={{ margin: "0 0 3px", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Total Stars:</p>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><FaStar style={{ color: "#facc15", fontSize: 16 }} /><span style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{entry ? score.toLocaleString() : "—"}</span></span>
          </div>
        )}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <p style={{ margin: "0 0 3px", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Reward</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 20, height: 20, objectFit: "contain" }} /><span style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{entry ? reward.gold.toLocaleString() : "—"}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Leaderboard() {
  const { user } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<"monthly" | "referral">("monthly");

  const { data: appSettings } = useQuery<any>({
    queryKey: ["/api/app-settings"],
    staleTime: 0,
    refetchInterval: 15000,
  });

  const {
    data: monthlyData,
    isLoading: loadingMonthly,
    refetch: refetchMonthly,
  } = useQuery<{
    leaderboard: MonthlyEntry[];
    userRank: { rank: number; weeklyStars: number } | null;
    userGold: number;
    userStars: number;
    contestActive: boolean;
    topN: number;
    prizes: string[];
    startDate: string | null;
    endDate: string | null;
  }>({
    queryKey: ["/api/leaderboard/weekly", "current"],
    queryFn: () => fetch("/api/leaderboard/weekly", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    refetchInterval: 30000,
    enabled: activeTab === "monthly",
  });

  const {
    data: referralData,
    isLoading: loadingReferral,
    refetch: refetchReferral,
  } = useQuery<{
    leaderboard: ReferralEntry[];
    userRank: { rank: number; referralCount: number } | null;
    contestActive: boolean;
    topN: number;
    prizes: string[];
    startDate: string | null;
    endDate: string | null;
  }>({
    queryKey: ["/api/leaderboard/referral"],
    queryFn: () => fetch("/api/leaderboard/referral", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    refetchInterval: 30000,
    enabled: activeTab === "referral",
  });

  const isMonthly = activeTab === "monthly";

  // Derive values from whichever tab is active
  const monthlyContestActive = monthlyData?.contestActive !== false;
  const referralContestActive = referralData?.contestActive !== false;
  const contestActive = isMonthly ? monthlyContestActive : referralContestActive;

  const monthlyTopN: number = monthlyData?.topN ?? appSettings?.monthlyContestTopUsers ?? 10;
  const referralTopN: number = referralData?.topN ?? appSettings?.weeklyReferralTopUsers ?? 10;
  const topN = isMonthly ? monthlyTopN : referralTopN;

  const monthlyPrizes: string[] = monthlyData?.prizes ?? [];
  const referralPrizes: string[] = referralData?.prizes ?? [];
  const prizes = isMonthly ? monthlyPrizes : referralPrizes;

  // Build a rank→entry map for O(1) lookup
  const monthlyMap = useMemo(() => {
    const m = new Map<number, MonthlyEntry>();
    (monthlyData?.leaderboard ?? []).forEach(e => m.set(e.rank, e));
    return m;
  }, [monthlyData?.leaderboard]);

  const referralMap = useMemo(() => {
    const m = new Map<number, ReferralEntry>();
    (referralData?.leaderboard ?? []).forEach(e => m.set(e.rank, e));
    return m;
  }, [referralData?.leaderboard]);

  // Dates
  const monthlyStartDate = monthlyData?.startDate || appSettings?.monthlyContestStartDate || null;
  const monthlyEndDateStr = monthlyData?.endDate || appSettings?.monthlyContestEndDate || null;
  const referralStartDate = referralData?.startDate || appSettings?.weeklyReferralStartDate || null;
  const referralEndDateStr = referralData?.endDate || appSettings?.weeklyReferralEndDate || null;

  const startDateLabel = formatDate(isMonthly ? monthlyStartDate : referralStartDate);
  const endDateLabel = formatDate(isMonthly ? monthlyEndDateStr : referralEndDateStr);

  const monthlyEndDate = useMemo(() => {
    if (!monthlyEndDateStr) return null;
    const d = new Date(monthlyEndDateStr);
    return isNaN(d.getTime()) ? null : d;
  }, [monthlyEndDateStr]);

  const referralEndDate = useMemo(() => {
    if (!referralEndDateStr) return null;
    const d = new Date(referralEndDateStr);
    return isNaN(d.getTime()) ? null : d;
  }, [referralEndDateStr]);

  const { d: md, h: mh, m: mm, s: ms } = useCountdown(monthlyEndDate);
  const { d: rd, h: rh, m: rm, s: rs } = useCountdown(referralEndDate);
  const { d, h, m, s } = isMonthly
    ? { d: md, h: mh, m: mm, s: ms }
    : { d: rd, h: rh, m: rm, s: rs };

  const myMonthlyRank = monthlyContestActive ? monthlyData?.userRank : null;
  const myReferralRank = referralContestActive ? referralData?.userRank : null;

  const isLoading = isMonthly ? loadingMonthly : loadingReferral;
  const refetch = isMonthly ? refetchMonthly : refetchReferral;

  const gemIcon = <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 11, height: 11, objectFit: "contain" }} />;
  const usersIcon = <FaUsers style={{ color: "#34d399", fontSize: 11 }} />;
  const scoreIcon = isMonthly ? gemIcon : usersIcon;

  // Slots: always render all topN positions
  const slots = Array.from({ length: topN }, (_, i) => i + 1);
  const top3 = slots.filter(r => r <= 3);
  const rest = slots.filter(r => r > 3);

  // Has any real data
  const hasData = isMonthly
    ? (monthlyData?.leaderboard ?? []).length > 0
    : (referralData?.leaderboard ?? []).length > 0;

  return (
    <Layout>
      <div style={{ background: "#0a0a0a", minHeight: "100%" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px 4px" }}>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
            {isMonthly ? "Weekly leaderboard based on ads watched. Resets every Sunday." : "Weekly leaderboard based on verified referrals. Resets every Sunday."}
          </p>
        </div>

        {/* ── Your Rank ── */}
        {isMonthly && (
          <div style={{ margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "14px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[['Your Rank', myMonthlyRank ? posLabel(myMonthlyRank.rank) : '—'], ['Ads Watched', (monthlyData?.userStars || myMonthlyRank?.weeklyStars || 0).toLocaleString()], ['Potential Rewards', myMonthlyRank ? (monthlyData?.prizes?.[Math.max(0, myMonthlyRank.rank - 1)] || '—') : '—']].map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 900, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</p>
              </div>
            ))}
          </div>
        )}
        {!isMonthly && (
          <div style={{ margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "14px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[
              ["Your Rank", myReferralRank ? posLabel(myReferralRank.rank) : "—"],
              ["Friends Invited", (myReferralRank?.referralCount ?? 0).toLocaleString()],
              ["Potential Rewards", myReferralRank ? `${(FIXED_REWARDS[myReferralRank.rank - 1]?.gold ?? 0).toLocaleString()} Gold` : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 900, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ padding: "14px 16px 0" }}>
          <div
            className="flex items-center"
            style={{ background: "#1a1a1a", borderRadius: 14, padding: "4px", gap: 2 }}
          >
            {(["monthly", "referral"] as const).map(tab => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 11,
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                    background: isActive ? "#2e2e2e" : "transparent",
                    border: "none", cursor: "pointer",
                    boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}
                >
                  {tab === "monthly" ? "Monthly" : "Referral"}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Date / countdown banner ── */}
        {(startDateLabel || endDateLabel) && (
          <div style={{ margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Started</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>{startDateLabel || "—"}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Ends</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>{endDateLabel || "—"}</p>
              </div>
            </div>
            {(monthlyEndDate || referralEndDate) && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Time left:</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>
                  {d}d {h}h {m}m {s}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 150, 300].map(delay => (
                <div
                  key={delay}
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "#22d3ee", animation: `pulse 1s ${delay}ms infinite` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Contest not active ── */}
        {!isLoading && isMonthly && !monthlyContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Admin will start the next Monthly Contest soon.</p>
          </div>
        )}
        {!isLoading && !isMonthly && !referralContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Admin will start the next Referral Contest soon.</p>
          </div>
        )}

        {/* ── Leaderboard ── */}
        {!isLoading && contestActive && (
          <>
            <div style={{ padding: "16px 16px 0" }}>
              {slots.map(rank => {
                const entry = isMonthly ? (monthlyMap.get(rank) ?? null) : (referralMap.get(rank) ?? null);
                const score = isMonthly
                  ? ((entry as MonthlyEntry | null)?.weeklyStars ?? 0)
                  : ((entry as ReferralEntry | null)?.referralCount ?? 0);
                const isMe = !!(entry && (entry as any).userId === user?.id);
                return (
                  <ParticipantCard
                    key={rank}
                    rank={rank}
                    entry={entry}
                    score={score}
                    isMonthly={isMonthly}
                    isMe={isMe}
                  />
                );
              })}
              <button
                onClick={() => refetch()}
                style={{ display: "block", margin: "2px auto 0", padding: "6px 12px", background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 11, cursor: "pointer" }}
              >
                <FaSync style={{ marginRight: 5, fontSize: 10 }} /> Refresh
              </button>
            </div>

            {/* No participants yet — but still show the grid */}
            {!hasData && (
              <div style={{ textAlign: "center", padding: "12px 24px 0" }}>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>
                  {isMonthly ? "Watch ads to earn stars and climb!" : "Invite friends who complete the requirement to rank up!"}
                </p>
              </div>
            )}
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </Layout>
  );
}
