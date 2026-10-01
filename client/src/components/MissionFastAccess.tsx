import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Ticket } from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { showAdgramAd } from "@/lib/showAd";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import DailyContestBanner from "@/components/DailyContestBanner";
import GameWithdrawPopup from "@/components/GameWithdrawPopup";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

type GameActionCardProps = {
  title: string;
  illustration: ReactNode;
  actionLabel: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

function GameActionCard({ title, illustration, actionLabel, disabled = false, busy = false, onClick }: GameActionCardProps) {
  const unavailable = disabled || busy;
  return (
    <button
      type="button"
      aria-label={`${title}: ${busy ? "Loading" : actionLabel}`}
      onClick={onClick}
      disabled={unavailable}
      className="group active:scale-[0.98] transition-transform"
      style={{
        display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 7, position: "relative",
        minWidth: 0, minHeight: 146, width: "100%", padding: 8, overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
        background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)",
        color: "#fff", cursor: unavailable ? "not-allowed" : "pointer",
        boxShadow: "0 8px 22px rgba(0,0,0,0.25)", opacity: unavailable ? 0.68 : 1,
      }}
    >
      <span aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: 76, flexShrink: 0, overflow: "hidden" }}>
        {illustration}
      </span>
      <span aria-hidden="true" style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: "100%", height: 36, minHeight: 36, boxSizing: "border-box", marginTop: "auto",
        borderRadius: 12,
        background: unavailable ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)",
        color: unavailable ? "rgba(255,255,255,0.45)" : "#fff",
        fontSize: 10, lineHeight: 1, fontWeight: 900, letterSpacing: "0.03em", whiteSpace: "nowrap",
      }}>
        {busy && <span style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.25)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite" }} />}
        {busy ? "PLEASE WAIT" : actionLabel}
      </span>
    </button>
  );
}

export default function MissionFastAccess() {
  const [, setLocation] = useLocation();
  const [showWithdrawPopup, setShowWithdrawPopup] = useState(false);
  const [showGiftCodePopup, setShowGiftCodePopup] = useState(false);
  const [checkinSheetOpen, setCheckinSheetOpen] = useState(false);
  const [dailyChecked, setDailyChecked] = useState(() => localStorage.getItem("daily_check_date") === getTodayKey());
  const [dailyAdLoading, setDailyAdLoading] = useState(false);
  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], staleTime: 0 });
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], staleTime: 300000, retry: false });
  const { data: checkinStatus } = useQuery<any>({
    queryKey: ["/api/daily-checkin/status"],
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const runVerifiedAdsgramReward = async (context: "daily_checkin") => {
    const sessionId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let backgroundEntered = false;
    let backgroundStartedAt = 0;
    let backgroundDuration = 0;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        backgroundEntered = true;
        backgroundStartedAt = Date.now();
      } else if (backgroundStartedAt) {
        backgroundDuration += Date.now() - backgroundStartedAt;
        backgroundStartedAt = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    try {
      const register = await apiRequest("POST", "/api/ads/register-session", { sessionId, adType: "adsgram", context });
      if (!register.ok) throw new Error("Could not start ad session");
      await showAdgramAd(appConfig?.adsgramRewardBlockId || "");
      if (document.visibilityState === "hidden") {
        await new Promise<void>((resolve) => {
          const onVisible = () => {
            if (document.visibilityState === "visible") {
              document.removeEventListener("visibilitychange", onVisible);
              resolve();
            }
          };
          document.addEventListener("visibilitychange", onVisible);
        });
      }
      if (backgroundStartedAt) backgroundDuration += Date.now() - backgroundStartedAt;
      return { sessionId, backgroundEntered, backgroundDuration };
    } finally {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (checkinStatus && typeof checkinStatus.alreadyClaimedToday === "boolean") {
      setDailyChecked(checkinStatus.alreadyClaimedToday);
      if (!checkinStatus.alreadyClaimedToday) localStorage.removeItem("daily_check_date");
    } else {
      const todayKey = getTodayKey();
      if (user.dailyCheckinClaimed && user.dailyTasksDate) {
        const serverDate = new Date(user.dailyTasksDate).toISOString().slice(0, 10);
        if (serverDate === todayKey) {
          setDailyChecked(true);
          localStorage.setItem("daily_check_date", todayKey);
        } else {
          setDailyChecked(false);
          localStorage.removeItem("daily_check_date");
        }
      } else if (!user.dailyCheckinClaimed) {
        setDailyChecked(false);
        localStorage.removeItem("daily_check_date");
      }
    }
  }, [user, checkinStatus]);

  const dailyCheckMutation = useMutation({
    mutationFn: async (session: { sessionId: string; backgroundEntered: boolean; backgroundDuration: number }) => {
      const res = await apiRequest("POST", "/api/daily-checkin", session);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      setDailyChecked(true);
      localStorage.setItem("daily_check_date", getTodayKey());
      showNotification(`Daily check-in done! +${data.reward ?? 5} Gold added`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (error: any) => {
      showNotification(error?.message || "Daily check-in failed. Try again.", "error");
    },
  });

  const handleDailyCheck = async () => {
    if (dailyChecked || dailyAdLoading || dailyCheckMutation.isPending) return;
    setDailyAdLoading(true);
    let session;
    try {
      session = await runVerifiedAdsgramReward("daily_checkin");
    } catch (error: any) {
      setDailyAdLoading(false);
      showNotification(error?.message || "Ad could not be completed", "error");
      return;
    }
    setDailyAdLoading(false);
    dailyCheckMutation.mutate(session);
  };

  const balance = Number.parseFloat(user?.walletBalance ?? user?.balance ?? "0");

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .mission-fast-access-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: 100%; margin: 0 auto; }`}</style>
      <section aria-labelledby="fast-access-title" style={{ marginBottom: 14 }}>
        <h2 id="fast-access-title" style={{ margin: "0 0 10px", color: "#fff", fontSize: 16, lineHeight: 1.2, fontWeight: 900 }}>Fast Access</h2>
        <div className="mission-fast-access-grid">
          <GameActionCard
            title="Daily Rewards"
            actionLabel={dailyChecked ? "CLAIMED" : "CHECK IN"}
            disabled={dailyChecked}
            busy={dailyAdLoading || dailyCheckMutation.isPending}
            onClick={() => setCheckinSheetOpen(true)}
            illustration={<img src="/assets/daily-checkin.png" alt="" style={{ width: 72, height: 72, objectFit: "contain" }} />}
          />
          <GameActionCard
            title="Gift Code"
            actionLabel="REDEEM"
            onClick={() => setShowGiftCodePopup(true)}
            illustration={<img src="/assets/gift-code-card.png" alt="" style={{ width: 72, height: 72, objectFit: "contain" }} />}
          />
          <GameActionCard
            title="Withdraw"
            actionLabel="WITHDRAW"
            onClick={() => setShowWithdrawPopup(true)}
            illustration={<img src="/assets/withdraw-card.png" alt="" style={{ width: 72, height: 72, objectFit: "contain" }} />}
          />
        </div>
        <DailyContestBanner prizePool={appConfig?.weeklyGiveawayAmount} onClick={() => setLocation("/leaderboard")} />
      </section>

      {showGiftCodePopup && (
        <PromoPopup
          onClose={() => setShowGiftCodePopup(false)}
          onSuccess={() => {
            setShowGiftCodePopup(false);
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          }}
        />
      )}
      <DailyCheckinSheet
        open={checkinSheetOpen}
        onClose={() => setCheckinSheetOpen(false)}
        streak={checkinStatus?.streak ?? 0}
        dayIndex={checkinStatus?.dayIndex ?? 0}
        alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? dailyChecked}
        onClaimed={() => {
          setDailyChecked(true);
          setCheckinSheetOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          queryClient.invalidateQueries({ queryKey: ["/api/daily-checkin/status"] });
        }}
      />
      <GameWithdrawPopup open={showWithdrawPopup} onClose={() => setShowWithdrawPopup(false)} userBalance={Math.floor(balance)} />
    </>
  );
}

function PromoPopup({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [adStep, setAdStep] = useState<"idle" | "redeeming">("idle");

  const handleRedeem = async () => {
    if (!code.trim()) {
      showNotification("Enter a promo code", "error");
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      setAdStep("redeeming");
      const res = await apiRequest("POST", "/api/promo-codes/redeem", { code: code.trim() });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || "Promo code redeemed!", "success");
        onSuccess();
      } else {
        showNotification(data.message || "Invalid promo code", "error");
      }
    } catch {
      showNotification("Failed to redeem. Try again.", "error");
    } finally {
      setLoading(false);
      setAdStep("idle");
    }
  };

  const buttonLabel = adStep === "redeeming" ? "APPLYING…" : "APPLY";
  const isDisabled = loading || !code.trim();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", alignItems: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} onClick={!loading ? onClose : undefined} />
      <div style={{
        position: "relative", width: "100%",
        background: "linear-gradient(160deg, #0d0d0f 0%, #111118 100%)",
        border: "1px solid rgba(61,21,128,0.3)", borderRadius: "28px 28px 0 0", padding: "24px 20px 52px", zIndex: 901,
        boxShadow: "0 -8px 60px rgba(61,21,128,0.24)", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)" }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", margin: "0 auto 22px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>Promo Code</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12, borderRadius: 14, background: "#171717", boxSizing: "border-box" }}>
          <Ticket size={26} color="rgba(255,255,255,0.7)" strokeWidth={2} style={{ flexShrink: 0 }} />
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => event.key === "Enter" && !isDisabled && handleRedeem()}
            placeholder="Enter code"
            disabled={loading}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            style={{ flex: 1, minWidth: 0, height: 40, padding: "0 16px", borderRadius: 20, border: "none", fontSize: 14, color: "#fff", letterSpacing: "0.02em", fontWeight: 700, background: "#2B2B2B", outline: "none", boxSizing: "border-box", opacity: loading ? 0.5 : 1 }}
          />
          <button
            onClick={handleRedeem}
            disabled={isDisabled}
            style={{
              width: 76, height: 38, flexShrink: 0, borderRadius: 10,
              background: isDisabled ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #3d1580, #6b21a8)",
              color: isDisabled ? "rgba(255,255,255,0.3)" : "#fff", border: "none", fontSize: 12, fontWeight: 800, letterSpacing: "0.03em",
              cursor: isDisabled ? "not-allowed" : "pointer", boxShadow: isDisabled ? "none" : "0 2px 12px rgba(61,21,128,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            className={isDisabled ? "" : "active:scale-95 transition-transform"}
          >
            {loading ? <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> : buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
