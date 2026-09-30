import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, HandCoins, Loader2, Pickaxe } from "lucide-react";
import FarmingMatrixCounter from "@/components/FarmingMatrixCounter";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";

const BASE_RATE_PER_HOUR = 23.9574;
const CYCLE_SECONDS = 60 * 60;

function formatCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function GameFarmingSection() {
  const queryClient = useQueryClient();
  const { data: farm, isLoading } = useQuery<any>({
    queryKey: ["/api/farming/state"],
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const [amount, setAmount] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(CYCLE_SECONDS);

  useEffect(() => {
    setAmount(Number(farm?.minedGold ?? farm?.minedAxn ?? 0));
    setRemainingSeconds(Number(farm?.remainingSeconds ?? CYCLE_SECONDS));
  }, [farm]);

  const ratePerHour = Math.max(0, Number(farm?.effectiveRate ?? BASE_RATE_PER_HOUR));
  const isActive = Boolean(farm?.isActive);
  const isComplete = isActive && remainingSeconds <= 0;

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(0, seconds - 1));
      setAmount((current) => Math.min(ratePerHour, current + ratePerHour / 3600));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isActive, ratePerHour]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/farming/start", {});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not start Farming");
      return data;
    },
    onSuccess: () => {
      showNotification("Farming started. Come back after the cycle to claim Gold.", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not start Farming", "error"),
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/farming/claim", {});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not claim Farming reward");
      return data;
    },
    onSuccess: (data) => {
      showNotification(`${Number(data.amount || 0).toFixed(2)} Gold claimed from Farming`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not claim Farming reward", "error"),
  });

  const pending = startMutation.isPending || claimMutation.isPending;
  const status = isLoading ? "LOADING" : isComplete ? "READY TO CLAIM" : isActive ? "ACTIVE" : "IDLE";
  const canStart = !isLoading && !isActive && !pending;
  const canClaim = isComplete && !pending;
  const progress = isActive ? Math.min(100, Math.max(0, ((CYCLE_SECONDS - remainingSeconds) / CYCLE_SECONDS) * 100)) : 0;

  return (
    <section style={{ maxWidth: 680, width: "100%", margin: "18px auto 0" }} aria-labelledby="farming-title">
      <h2 id="farming-title" style={{ margin: "0 0 10px", color: "#fff", fontSize: 16, lineHeight: 1.2, fontWeight: 900 }}>Farming</h2>
      <div style={{ background: "#141414", borderRadius: 16, padding: 16, border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 8px 24px rgba(0,0,0,0.24)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ color: "#8e8e93", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Farming status</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: isComplete ? "#39ff14" : isActive ? "#39ff14" : "#8e8e93", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isComplete || isActive ? "#39ff14" : "#6b7280", boxShadow: isActive ? "0 0 8px #39ff14" : "none", animation: isActive ? "pulse 1.5s infinite" : "none" }} />
            {status}
          </span>
        </div>

        <div style={{ marginBottom: 12 }}>
          <FarmingMatrixCounter amount={amount} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ color: "#8e8e93", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {ratePerHour.toFixed(4)} Gold / hour
          </span>
          <span style={{ color: "#8e8e93", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            {isActive ? <><Clock size={11} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />{formatCountdown(remainingSeconds)}</> : "1-hour cycle"}
          </span>
        </div>

        <div style={{ height: 3, width: "100%", background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #00b309, #39ff14)", transition: "width 0.5s linear" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={!canStart}
            className="active:scale-[0.98] transition-transform"
            style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: 0, borderRadius: 12, background: canStart ? "#007aff" : "rgba(0,122,255,0.25)", color: "#fff", opacity: canStart ? 1 : 0.62, cursor: canStart ? "pointer" : "not-allowed", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}
          >
            {startMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Pickaxe size={15} />}
            {startMutation.isPending ? "Starting" : isActive ? "Farming" : "Start"}
          </button>
          <button
            type="button"
            onClick={() => claimMutation.mutate()}
            disabled={!canClaim}
            className="active:scale-[0.98] transition-transform"
            style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: 0, borderRadius: 12, background: canClaim ? "#007aff" : "rgba(0,122,255,0.25)", color: "#fff", opacity: canClaim ? 1 : 0.62, cursor: canClaim ? "pointer" : "not-allowed", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}
          >
            {claimMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <HandCoins size={15} />}
            {claimMutation.isPending ? "Claiming" : "Claim"}
          </button>
        </div>
      </div>
    </section>
  );
}
