import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import { apiRequest } from "@/lib/queryClient";
import { cancelRegisteredAdSession, confirmProviderCompletion, postWithAdVerification } from "@/lib/adRewardClaim";
import { showAdgramAd } from "@/lib/showAd";
import DailyMissionTasks from "@/components/DailyMissionTasks";

const MYSTERY_DAILY_LIMIT = 1;

type AdProof = { sessionId: string; backgroundEntered: boolean; backgroundDuration: number };

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function MissionDailyRewards() {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
  const [mysteryClaimsToday, setMysteryClaimsToday] = useState(0);
  const [mysteryAdLoading, setMysteryAdLoading] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false });
  const { data: appConfig } = useQuery<any>({
    queryKey: ["/api/config/app"],
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => {
    if (!user) return;
    if (user.mysteryBoxDate) {
      const serverDate = new Date(user.mysteryBoxDate).toISOString().slice(0, 10);
      setMysteryClaimsToday(serverDate === getTodayKey() ? (user.mysteryBoxCount ?? 0) : 0);
    } else {
      setMysteryClaimsToday(0);
    }
  }, [user]);

  const runVerifiedAdsgramAd = async (context: "mystery_box"): Promise<AdProof> => {
    const sessionId = startSession();
    try {
      const response = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: "adsgram",
        context,
      });
      if (!response.ok) throw new Error("Could not start ad session");
      const blockId = appConfig?.adsgramMysteryBoxBlockId || import.meta.env.VITE_ADSGRAM_MYSTERY_BLOCK_ID || "";
      await showAdgramAd(blockId);
      await confirmProviderCompletion(sessionId, "adsgram");
      await waitForForeground();
      const session = endSession();
      return {
        sessionId: session.sessionId,
        backgroundEntered: session.backgroundEntered,
        backgroundDuration: session.backgroundDuration,
      };
    } catch (error) {
      await cancelRegisteredAdSession(sessionId);
      cancelSession();
      throw error;
    }
  };
  const handleMysteryOpen = async () => {
    if (mysteryClaimsToday >= MYSTERY_DAILY_LIMIT || mysteryAdLoading) return;
    setMysteryAdLoading(true);
    let proof: AdProof;
    try {
      proof = await runVerifiedAdsgramAd("mystery_box");
    } catch {
      setMysteryAdLoading(false);
      showNotification("Ad was not completed. No Mystery Box reward was granted.", "error");
      return;
    }

    try {
      const data = await postWithAdVerification("/api/mystery-box", proof);
      if (typeof data.claimsToday === "number") setMysteryClaimsToday(data.claimsToday);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      showNotification("Mystery Box reward added to your AXN balance.", "success");
    } catch (error: any) {
      showNotification(error?.message || "Failed to open Mystery Box. Try again.", "error");
    } finally {
      setMysteryAdLoading(false);
    }
  };

  const mysteryOpened = mysteryClaimsToday >= MYSTERY_DAILY_LIMIT;

  return (
    <>
      <style>{`@keyframes spin-mission-rewards { to { transform: rotate(360deg); } }`}</style>
      <div
        aria-label="Daily rewards"
        style={{
          width: "100%",
          borderRadius: 16,
          overflow: "hidden",
          background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)",
          boxShadow: "0 8px 22px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>Mystery Box</div>
          </div>
          <button
            type="button"
            onClick={handleMysteryOpen}
            disabled={mysteryOpened || mysteryAdLoading}
            style={{
              background: mysteryOpened ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)",
              color: mysteryOpened ? "rgba(255,255,255,0.3)" : "#fff",
              border: "none", width: 92, height: 38, borderRadius: 12, padding: 0, fontSize: 12, fontWeight: 800,
              cursor: mysteryOpened || mysteryAdLoading ? "not-allowed" : "pointer", flexShrink: 0, whiteSpace: "nowrap",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              boxShadow: mysteryOpened ? "none" : "0 2px 12px rgba(37,99,235,0.4)",
            }}
            className="active:scale-95 transition-transform"
          >
            {mysteryAdLoading ? (
              <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", display: "inline-block", animation: "spin-mission-rewards 0.7s linear infinite" }} />
            ) : mysteryOpened ? "DONE" : "OPEN"}
          </button>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />
        <DailyMissionTasks />
      </div>
    </>
  );
}
