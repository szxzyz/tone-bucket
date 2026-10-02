import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import { apiRequest } from "@/lib/queryClient";
import { useAdFlow } from "@/hooks/useAdFlow";

const MYSTERY_DAILY_LIMIT = 5;

type AdProof = { sessionId: string; backgroundEntered: boolean; backgroundDuration: number };

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function MissionDailyRewards() {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession } = useAdSession();
  const { showMonetagAd } = useAdFlow();
  const [checkinSheetOpen, setCheckinSheetOpen] = useState(false);
  const [mysteryClaimsToday, setMysteryClaimsToday] = useState(0);
  const [mysteryAdLoading, setMysteryAdLoading] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false });
  const { data: appConfig } = useQuery<any>({
    queryKey: ["/api/config/app"],
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: checkinStatus } = useQuery<any>({
    queryKey: ["/api/daily-checkin/status"],
    queryFn: async () => {
      const response = await fetch("/api/daily-checkin/status", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
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

  const runVerifiedMonetagAd = async (context: "mystery_box"): Promise<AdProof> => {
    const sessionId = startSession();
    try {
      const response = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: "monetag",
        context,
      });
      if (!response.ok) throw new Error("Could not start ad session");
      const adResult = await showMonetagAd();
      if (!adResult.success) throw new Error("Monetag ad was not completed");
      const session = endSession();
      return {
        sessionId: session.sessionId,
        backgroundEntered: session.backgroundEntered,
        backgroundDuration: session.backgroundDuration,
      };
    } catch (error) {
      cancelSession();
      throw error;
    }
  };
  const handleMysteryOpen = async () => {
    if (mysteryClaimsToday >= MYSTERY_DAILY_LIMIT || mysteryAdLoading) return;
    setMysteryAdLoading(true);
    let proof: AdProof;
    try {
      proof = await runVerifiedMonetagAd("mystery_box");
    } catch {
      setMysteryAdLoading(false);
      showNotification("Ad was not completed. No Mystery Box reward was granted.", "error");
      return;
    }

    try {
      const response = await apiRequest("POST", "/api/mystery-box", proof);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed");
      if (typeof data.claimsToday === "number") setMysteryClaimsToday(data.claimsToday);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      showNotification("Mystery Box reward added to your GEM balance.", "success");
    } catch (error: any) {
      showNotification(error?.message || "Failed to open Mystery Box. Try again.", "error");
    } finally {
      setMysteryAdLoading(false);
    }
  };

  const checkinClaimed = Boolean(checkinStatus?.alreadyClaimedToday);
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
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <polyline points="9 16 11 18 15 14" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>Daily Check-In</div>
          </div>
          <button
            type="button"
            onClick={() => setCheckinSheetOpen(true)}
            disabled={checkinClaimed}
            style={{
              background: checkinClaimed ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)",
              color: checkinClaimed ? "rgba(255,255,255,0.3)" : "#fff",
              border: "none", width: 92, height: 38, borderRadius: 12, padding: 0, fontSize: 12, fontWeight: 800,
              cursor: checkinClaimed ? "not-allowed" : "pointer", flexShrink: 0, letterSpacing: "0.03em", whiteSpace: "nowrap",
              boxShadow: checkinClaimed ? "none" : "0 2px 12px rgba(37,99,235,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            }}
            className="active:scale-95 transition-transform"
          >
            {checkinClaimed ? "DONE" : "CHECK"}
          </button>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />

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
      </div>

      <DailyCheckinSheet
        open={checkinSheetOpen}
        onClose={() => setCheckinSheetOpen(false)}
        streak={checkinStatus?.streak ?? 0}
        dayIndex={checkinStatus?.dayIndex ?? 0}
        alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? false}
        adsgramBlockId={appConfig?.adsgramCheckinBlockId || ""}
        onClaimed={() => {
          setCheckinSheetOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/daily-checkin/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          queryClient.invalidateQueries({ queryKey: ["/api/missions/status"] });
        }}
      />
    </>
  );
}
