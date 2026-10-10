import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import { apiRequest } from "@/lib/queryClient";
import { cancelRegisteredAdSession, confirmProviderCompletion, postWithAdVerification } from "@/lib/adRewardClaim";
import { showAdgramAd } from "@/lib/showAd";

// Seven-day check-in rewards; the final reward repeats for longer streaks.
export const CHECKIN_REWARDS = [2, 4, 6, 9, 13, 17, 21];

interface DailyCheckinSheetProps {
  open: boolean;
  /** Reward day returned from GET /api/daily-checkin/status */
  dayIndex: number;
  alreadyClaimedToday: boolean;
  onClaimed: (data: { reward: number; newStreak: number }) => void;
  /** AdsGram interstitial block id (env-based, never hardcoded). Optional. */
  adsgramBlockId?: string;
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
  dayIndex,
  alreadyClaimedToday,
  onClaimed,
  adsgramBlockId,
}: DailyCheckinSheetProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
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
    } catch (error: any) {
      await cancelRegisteredAdSession(sessionId);
      cancelSession();
      setAdLoading(false);
      showNotification(error?.message || "Ad reward verification failed. Please try again.", "error");
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
  if (!open) return null;

  return (
    <section aria-label="Daily check-in rewards" style={{ width: "100%", maxWidth: 448, margin: "0 auto", padding: 14, boxSizing: "border-box", borderRadius: 16, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,0.25)" }}>
      <div style={{ position: "relative", width: "100%" }}>
        {/* Compact seven-day reward cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 5,
            overflowX: "hidden",
            paddingBottom: 8,
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
                  minWidth: 0,
                  borderRadius: 12,
                  border: isCurrentDay
                    ? "2px solid #2563eb"
                    : "1px solid rgba(255,255,255,0.08)",
                  background: isCurrentDay ? "rgba(37,99,235,0.1)" : "rgba(255,255,255,0.04)",
                  padding: "7px 3px 6px",
                  textAlign: "center",
                  opacity: isFuture ? 0.5 : 1,
                  boxShadow: isCurrentDay ? "0 0 20px rgba(37,99,235,0.3)" : "none",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: isCurrentDay ? "#60a5fa" : "rgba(255,255,255,0.5)",
                  }}
                >
                  D{idx + 1}
                </div>
                <div style={{ margin: "5px auto 4px" }}>
                  <GemCoin size={23} circle />
                </div>
                <div
                  style={{
                    fontSize: 14,
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
                    fontSize: 9,
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
              height: 38,
              borderRadius: 12,
              border: "none",
              background: alreadyClaimedToday
                ? "rgba(255,255,255,0.07)"
                : "linear-gradient(135deg, #2563eb, #3b82f6)",
              color: alreadyClaimedToday ? "rgba(255,255,255,0.25)" : "#fff",
              fontSize: 12,
              fontWeight: 800,
              cursor: isPending || alreadyClaimedToday ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "none",
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
    </section>
  );
}
