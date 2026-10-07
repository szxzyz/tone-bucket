import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { showNotification } from "@/components/AppNotification";
import PopupShell from "@/components/PopupShell";
import { useAdSession } from "@/hooks/useAdSession";
import { apiRequest } from "@/lib/queryClient";
import { cancelRegisteredAdSession, confirmProviderCompletion, postWithAdVerification } from "@/lib/adRewardClaim";
import { showAdgramAd } from "@/lib/showAd";

// 7-day streak rewards (AXN) — mirrors server CHECKIN_REWARDS
export const CHECKIN_REWARDS = [78, 82, 90, 97, 117, 136, 194];

interface DailyCheckinSheetProps {
  open: boolean;
  onClose: () => void;
  /** streak state returned from GET /api/daily-checkin/status */
  streak: number;
  dayIndex: number;
  alreadyClaimedToday: boolean;
  onClaimed: (data: { reward: number; newStreak: number }) => void;
  /** AdsGram interstitial block id (env-based, never hardcoded). Optional. */
  adsgramBlockId?: string;
}

// Same calendar icon used by the Home "Daily Check-In" card — same colour.
function CalendarIcon({ color = "#2563eb", size = 22 }: { color?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="9 16 11 18 15 14" />
    </svg>
  );
}

function GemCoin({ size = 20, circle = false }: { size?: number; circle?: boolean }) {
  // Same circular style as the AXN balance icon in the app header
  return (
    <img
      src="/assets/axionet-mining.webp"
      alt="AXN"
      draggable={false}
      style={{
        width: size,
        height: size,
        maxWidth: size,
        borderRadius: "50%",
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
        margin: "0 auto",
      }}
    />
  );
}

export default function DailyCheckinSheet({
  open,
  onClose,
  streak,
  dayIndex,
  alreadyClaimedToday,
  onClaimed,
  adsgramBlockId,
}: DailyCheckinSheetProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
  const [adShown, setAdShown] = useState(false);
  const [adLoading, setAdLoading] = useState(false);

  const claimMutation = useMutation({
    mutationFn: async ({ doubleReward = false, proof = null }: { doubleReward?: boolean; proof?: any }) => {
      return postWithAdVerification<{ success: boolean; reward: number; newStreak: number; isDouble?: boolean }>(
        "/api/missions/daily-checkin/claim",
        { doubleReward, proof },
      );
    },
    onSuccess: (data) => {
      showNotification(`${data.reward} AXN claimed`, "success");
      playClaimSuccessEffects();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-checkin/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions/status"] });
      onClaimed(data);
    },
    onError: (err: Error) => {
      showNotification(err.message, "error");
    },
    onSettled: () => setAdLoading(false),
  });

  const handleClaim = async () => {
    if (claimMutation.isPending || adLoading || alreadyClaimedToday) return;
    setAdLoading(true);
    const sessionId = startSession();
    try {
      const registration = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: "adsgram",
        context: "daily_checkin",
      });
      if (!registration.ok) throw new Error("Ad verification is not available right now");
      const blockId = adsgramBlockId || import.meta.env.VITE_ADSGRAM_CHECKIN_BLOCK_ID || import.meta.env.VITE_ADSGRAM_BLOCK_ID || "";
      await showAdgramAd(blockId);
      await confirmProviderCompletion(sessionId, "adsgram");
      await waitForForeground();
      const session = endSession();
      claimMutation.mutate({
        doubleReward: false,
        proof: {
          sessionId: session.sessionId,
          backgroundEntered: session.backgroundEntered,
          backgroundDuration: session.backgroundDuration,
        },
      });
    } catch {
      await cancelRegisteredAdSession(sessionId);
      cancelSession();
      setAdLoading(false);
      showNotification("Please interact with ads.", "error");
    }
  };

  // ── Claim success feedback: Telegram haptic + coin-claim sound ──
  const playClaimSuccessEffects = () => {
    const tg = window.Telegram?.WebApp as any;
    // Telegram native haptic vibration (works in TG app)
    try {
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred("success");
      } else if (tg?.hapticFeedback) {
        tg.hapticFeedback("impact", "medium");
      }
    } catch {
      /* haptics may not be available outside Telegram */
    }
    // Light coin-claim chime via Web Audio API (works everywhere)
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      // Two-note ascending "coin" chime
      const notes = [
        { t: 0, freq: 880, dur: 0.12 },
        { t: 0.10, freq: 1318.5, dur: 0.22 },
      ];
      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(note.freq, now + note.t);
        gain.gain.setValueAtTime(0, now + note.t);
        gain.gain.linearRampToValueAtTime(0.25, now + note.t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.t + note.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + note.t);
        osc.stop(now + note.t + note.dur + 0.02);
      }
      ctx.close().catch(() => {});
    } catch {
      /* audio errors should never surface */
    }
  };

  const isPending = claimMutation.isPending || adLoading;
  const daysRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const current = daysRef.current?.children?.[Math.min(dayIndex, CHECKIN_REWARDS.length - 1)] as HTMLElement | undefined;
    current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [open, dayIndex]);

  if (!open) return null;

  return (
    <PopupShell onClose={onClose} maxWidth={390}>
      <div style={{ position: "relative", width: "100%" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <polyline points="9 16 11 18 15 14"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 900,
                color: "#fff",
                lineHeight: 1.1,
                letterSpacing: "0.02em",
              }}
            >
              {alreadyClaimedToday
                ? <span>CHECK-IN <span style={{ color: "#2563eb" }}>DONE</span></span>
                : <span>DAILY <span style={{ color: "#2563eb" }}>CHECK-IN</span></span>}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#60a5fa",
                marginTop: 3,
                lineHeight: 1.2,
              }}
            >
              {!alreadyClaimedToday &&
                (streak > 0
                  ? `Keep it up — streak ${streak} day${streak > 1 ? "s" : ""}`
                  : "Start your streak today")}
              {alreadyClaimedToday && "Come back tomorrow for more rewards"}
            </div>
          </div>
          {/* Streak pill */}
          {streak > 0 && (
            <div
              style={{
                flexShrink: 0,
                background: "rgba(59,130,246,0.16)",
                borderRadius: 20,
                padding: "4px 10px",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <CalendarIcon color="#60a5fa" size={13} />
              <span
                style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", lineHeight: 1 }}
              >
                {streak}
              </span>
            </div>
          )}
        </div>

        {/* Horizontal scrolling day cards */}
        <div
          ref={daysRef}
          style={{
            display: "flex",
            gap: 10,
            overflowX: "auto",
            paddingBottom: 16,
            scrollSnapType: "x mandatory",
            WebkitOverflowScrolling: "touch",
          }}
          className="scrollbar-hide"
        >
          {CHECKIN_REWARDS.map((reward, idx) => {
            const isCurrentDay = idx === dayIndex && !alreadyClaimedToday;
            const isPast = idx < dayIndex || alreadyClaimedToday;
            const isFuture = idx > dayIndex && !alreadyClaimedToday;
            return (
              <div
                key={idx}
                style={{
                  flex: "0 0 auto",
                  width: 80,
                  borderRadius: 16,
                  border: isCurrentDay
                    ? "2px solid #2563eb"
                    : "1px solid rgba(255,255,255,0.08)",
                  background: isCurrentDay ? "rgba(37,99,235,0.1)" : "rgba(255,255,255,0.04)",
                  padding: "12px 4px 11px",
                  textAlign: "center",
                  scrollSnapAlign: "start",
                  opacity: isFuture ? 0.5 : 1,
                  boxShadow: isCurrentDay ? "0 0 20px rgba(37,99,235,0.3)" : "none",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: isCurrentDay ? "#60a5fa" : "rgba(255,255,255,0.5)",
                  }}
                >
                  D{idx + 1}
                </div>
                <div style={{ margin: "8px auto 6px" }}>
                  <GemCoin size={36} circle />
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    color: isPast ? "#60a5fa" : "#fff",
                    lineHeight: 1.1,
                    marginTop: 3,
                  }}
                >
                  {reward.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: isPast ? "rgba(96,165,250,0.7)" : "rgba(255,255,255,0.35)",
                    marginTop: 1,
                  }}
                >
                  AXN
                </div>
              </div>
            );
          })}
        </div>

        {/* Claim buttons row */}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={handleClaim}
            disabled={isPending || alreadyClaimedToday}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 12,
              border: "none",
              background: alreadyClaimedToday
                ? "rgba(255,255,255,0.07)"
                : "linear-gradient(135deg, #1d4ed8, #2563eb)",
              color: alreadyClaimedToday ? "rgba(255,255,255,0.25)" : "#fff",
              fontSize: 14,
              fontWeight: 800,
              cursor: isPending || alreadyClaimedToday ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: alreadyClaimedToday ? "none" : "0 4px 16px rgba(37,99,235,0.4)",
            }}
            className="active:scale-95 transition-transform"
          >
            {isPending ? (
              <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin-hdc 0.7s linear infinite" }} />
            ) : alreadyClaimedToday ? (
              "CLAIMED TODAY"
            ) : (
              "CLAIM REWARD"
            )}
          </button>
        </div>
        <style>{`@keyframes spin-hdc { to { transform: rotate(360deg); } }`}</style>
      </div>
    </PopupShell>
  );
}
