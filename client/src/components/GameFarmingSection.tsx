import { useEffect, useState } from "react";
import { HandCoins, Loader2, Pickaxe, Rocket } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { showAdgramAd } from "@/lib/showAd";
import FarmingMatrixCounter from "@/components/FarmingMatrixCounter";

const BASE_RATE_PER_HOUR = 23.9574;
const CYCLE_SECONDS = 60 * 60;
const MINING_BOOSTS = [1, 2, 4, 8, 10, 15, 20, 25];

function formatCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

const cardStyle: React.CSSProperties = {
  background: "#1b1b1b",
  borderRadius: 16,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.05)",
};

const actionButtonStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  border: "none",
  borderRadius: 12,
  color: "#fff",
  fontWeight: 900,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  cursor: "pointer",
};

export default function GameFarmingSection() {
  const queryClient = useQueryClient();
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], staleTime: 300_000, retry: false });
  const { data: farm, isLoading } = useQuery<any>({
    queryKey: ["/api/farming/state"],
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const [amount, setAmount] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(CYCLE_SECONDS);
  const [showBoostPopup, setShowBoostPopup] = useState(false);

  useEffect(() => {
    setAmount(Number(farm?.minedGold ?? farm?.minedAxn ?? 0));
    setRemainingSeconds(Number(farm?.remainingSeconds ?? 0));
  }, [farm]);

  const ratePerHour = Math.max(0, Number(farm?.effectiveRate ?? BASE_RATE_PER_HOUR));
  const isActive = Boolean(farm?.isActive);
  const isComplete = isActive && (Boolean(farm?.isComplete) || remainingSeconds <= 0);
  const isRunning = isActive && !isComplete;
  const progress = isActive ? Math.min(100, Math.max(0, ((CYCLE_SECONDS - remainingSeconds) / CYCLE_SECONDS) * 100)) : 0;
  const multiplier = Math.max(1, Number(farm?.multiplier ?? 1));
  const currentBoostIndex = MINING_BOOSTS.indexOf(multiplier);
  const nextBoost = MINING_BOOSTS[Math.min(MINING_BOOSTS.length - 1, Math.max(0, currentBoostIndex) + 1)];
  const maxBoostReached = multiplier >= MINING_BOOSTS[MINING_BOOSTS.length - 1];

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(0, seconds - 1));
      setAmount((current) => Math.min(ratePerHour, current + ratePerHour / 3600));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, ratePerHour]);

  const runFarmAction = async (endpoint: string, watchAd = false) => {
    if (watchAd) await showAdgramAd(appConfig?.adsgramRewardBlockId || "");
    const response = await apiRequest("POST", endpoint, {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Mining action failed");
    return data;
  };

  const startMutation = useMutation({
    mutationFn: () => runFarmAction("/api/farming/start"),
    onSuccess: () => {
      showNotification("Mining cycle started", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not start mining", "error"),
  });

  const claimMutation = useMutation({
    mutationFn: () => runFarmAction("/api/farming/claim", true),
    onSuccess: (data) => {
      showNotification(`${Number(data.amount || 0).toFixed(4)} AXN collected`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not collect AXN", "error"),
  });

  const boostMutation = useMutation({
    mutationFn: () => runFarmAction("/api/farming/boost", true),
    onSuccess: (data) => {
      showNotification(`Mining boosted to ${data.multiplier ?? "next"}x`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
      setShowBoostPopup(false);
    },
    onError: (error: any) => showNotification(error?.message || "Could not boost mining", "error"),
  });

  const pending = startMutation.isPending || claimMutation.isPending;
  const statusLabel = isLoading ? "Loading" : isComplete ? "Complete" : isRunning ? "Active" : "Ready";
  const statusColor = isRunning ? "#22c55e" : isComplete ? "#60a5fa" : "#8E8E93";

  return (
    <section aria-labelledby="mining-card-title" style={{ marginBottom: 20 }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span id="mining-card-title" style={{ color: "#8E8E93", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Mining rate · {ratePerHour.toFixed(2)} AXN/hour
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, boxShadow: isRunning ? `0 0 8px ${statusColor}` : "none" }} />
            <span style={{ color: statusColor, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em" }}>{statusLabel}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <img src="/assets/axionet-mining.webp" alt="AXN" style={{ width: 50, height: 50, flexShrink: 0, objectFit: "contain" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <FarmingMatrixCounter amount={amount} decimals={4} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "#8E8E93", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: isRunning ? 14 : 16 }}>
          <span>{isRunning ? `Mining · ${formatCountdown(remainingSeconds)}` : isComplete ? "Cycle complete" : "Cycle ready"}</span>
          <span>{ratePerHour.toFixed(2)} AXN/h · {multiplier}x</span>
        </div>

        {isRunning && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#2563eb,#60a5fa)", transition: "width .5s linear" }} />
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <button type="button" onClick={() => setShowBoostPopup(true)} className="active:scale-95 transition-transform" style={{ ...actionButtonStyle, background: "#007AFF", boxShadow: "0 8px 20px rgba(0,122,255,0.18)" }}>
            <Rocket size={16} /> Boost
          </button>
          {pending ? (
            <button type="button" disabled style={{ ...actionButtonStyle, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
              <Loader2 size={15} className="animate-spin" /> {claimMutation.isPending ? "Claiming…" : "Starting…"}
            </button>
          ) : isComplete ? (
            <button type="button" onClick={() => claimMutation.mutate()} className="active:scale-95 transition-transform" style={{ ...actionButtonStyle, background: "#007AFF", boxShadow: "0 8px 20px rgba(0,122,255,0.18)" }}>
              <HandCoins size={16} /> Claim
            </button>
          ) : isRunning ? (
            <button type="button" disabled style={{ ...actionButtonStyle, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
              <Pickaxe size={15} /> Mining
            </button>
          ) : (
            <button type="button" onClick={() => startMutation.mutate()} disabled={isLoading} className="active:scale-95 transition-transform" style={{ ...actionButtonStyle, background: isLoading ? "rgba(255,255,255,0.08)" : "#007AFF", color: isLoading ? "rgba(255,255,255,0.5)" : "#fff", boxShadow: isLoading ? "none" : "0 8px 20px rgba(0,122,255,0.18)" }}>
              {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Pickaxe size={16} />} Start
            </button>
          )}
        </div>
      </div>

      {showBoostPopup && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, display: "flex", alignItems: "flex-end" }}>
          <button type="button" aria-label="Close boost dialog" onClick={() => setShowBoostPopup(false)} style={{ position: "absolute", inset: 0, border: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} />
          <div role="dialog" aria-modal="true" aria-labelledby="boost-dialog-title" style={{ position: "relative", width: "100%", background: "linear-gradient(160deg, #0d0d0f, #0f0f0f)", borderRadius: "28px 28px 0 0", padding: "28px 20px max(32px, calc(env(safe-area-inset-bottom, 0px) + 20px))", textAlign: "center" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.14)", margin: "0 auto 24px" }} />
            <div id="boost-dialog-title" style={{ color: "#fff", fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Upgrade multiplier</div>
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, textTransform: "uppercase" }}>Current boost</div>
              <div style={{ color: "#c084fc", fontSize: 24, fontWeight: 900 }}>{multiplier}x</div>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 3 }}>{maxBoostReached ? "Maximum boost reached" : `Watch an ad to unlock the next level: ${nextBoost}x`}</div>
            </div>
            <button type="button" onClick={() => boostMutation.mutate()} disabled={!isRunning || boostMutation.isPending || maxBoostReached} style={{ width: "100%", padding: 14, background: "linear-gradient(135deg, #2563eb, #3b82f6)", border: 0, borderRadius: 14, color: "#fff", fontWeight: 800, opacity: !isRunning || boostMutation.isPending || maxBoostReached ? 0.45 : 1 }}>
              {boostMutation.isPending ? "Watching ad…" : maxBoostReached ? "Maximum boost reached" : "Watch ad to boost"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
