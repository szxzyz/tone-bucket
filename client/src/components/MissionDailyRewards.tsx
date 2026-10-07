import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import { apiRequest } from "@/lib/queryClient";
import { cancelRegisteredAdSession, confirmProviderCompletion, postWithAdVerification } from "@/lib/adRewardClaim";
import { showAdgramAd } from "@/lib/showAd";
import DailyMissionTasks from "@/components/DailyMissionTasks";
import { GoldIcon } from "@/components/GameGoldIcon";
import { CHECKIN_REWARDS } from "@/components/DailyCheckinSheet";
import { useLanguage } from "@/hooks/useLanguage";

const MYSTERY_DAILY_LIMIT = 1;

type AdProof = { sessionId: string; backgroundEntered: boolean; backgroundDuration: number };

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function MissionDailyRewards() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
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

  const checkinClaimed = Boolean(checkinStatus?.alreadyClaimedToday);
  const mysteryOpened = mysteryClaimsToday >= MYSTERY_DAILY_LIMIT;
  const checkinReward = Number(checkinStatus?.reward ?? CHECKIN_REWARDS[checkinStatus?.dayIndex ?? 0] ?? CHECKIN_REWARDS[0]);

  return (
    <section aria-label={t("daily_task")} style={{ width: "100%", marginBottom: 16 }}>
      <style>{`@keyframes spin-mission-rewards { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.12em", textTransform: "uppercase", paddingLeft: 4 }}>
        {t("daily_task")}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2, marginBottom: 8, paddingLeft: 4 }}>
        {t("daily_task_hint")}
      </div>
      <div
        aria-label="Daily rewards"
        style={{
          width: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background: "#252525",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px" }}>
          <img src="/assets/check-in.png" alt={t("daily_checkin")} style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>{t("daily_checkin")}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 7 }}>
              <GoldIcon size={20} />
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 900 }}>{checkinReward.toLocaleString()}</span>
            </div>
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
            {checkinClaimed ? t("done") : t("claim")}
          </button>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px" }}>
          <img src="/assets/mystery-box.png" alt={t("mystery_gift")} style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>{t("mystery_gift")}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 7 }}>
              <GoldIcon size={20} />
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 900 }}>10–100</span>
            </div>
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
            ) : mysteryOpened ? t("done") : t("open")}
          </button>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />
        <DailyMissionTasks />
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
    </section>
  );
}
