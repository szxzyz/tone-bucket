import { useEffect, useState } from "react";
import { Clock, HandCoins, Loader2, Pickaxe, Rocket } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { showAdgramAd } from "@/lib/showAd";

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
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], staleTime: 300_000, retry: false });
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

  const runFarmAction = async (endpoint: string, watchAd = false) => {
    if (watchAd) await showAdgramAd(appConfig?.adsgramRewardBlockId || "");
    const response = await apiRequest("POST", endpoint, {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Farming action failed");
    return data;
  };

  const startMutation = useMutation({
    mutationFn: () => runFarmAction("/api/farming/start"),
    onSuccess: () => {
      showNotification("Farming started. AXN mining is now active.", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not start farming", "error"),
  });

  const claimMutation = useMutation({
    mutationFn: () => runFarmAction("/api/farming/claim", true),
    onSuccess: (data) => {
      showNotification(`${Number(data.amount || 0).toFixed(2)} AXN claimed`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not claim AXN", "error"),
  });

  const boostMutation = useMutation({
    mutationFn: () => runFarmAction("/api/farming/boost", true),
    onSuccess: (data) => {
      showNotification(`Mining boosted to ${data.multiplier ?? "next"}x`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not boost mining", "error"),
  });

  const pending = startMutation.isPending || claimMutation.isPending || boostMutation.isPending;
  const status = isLoading ? "LOADING" : isComplete ? "READY TO CLAIM" : isActive ? "ACTIVE" : "READY";
  const canStart = !isLoading && !isActive && !pending;
  const canClaim = isComplete && !pending;
  const canBoost = isActive && !pending;
  const progress = isActive ? Math.min(100, Math.max(0, ((CYCLE_SECONDS - remainingSeconds) / CYCLE_SECONDS) * 100)) : 0;

  return (
    <section style={{ maxWidth: 680, width: "100%", margin: "18px auto 0" }} aria-labelledby="farming-title">
      <style>{`@keyframes axionet-float { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-7px) scale(1.025); } } @keyframes axionet-glow { 0%,100% { filter: drop-shadow(0 0 8px rgba(0,122,255,.2)); } 50% { filter: drop-shadow(0 0 26px rgba(0,122,255,.8)); } }`}</style>
      <h2 id="farming-title" style={{ margin: "0 0 10px", color: "#fff", fontSize: 16, lineHeight: 1.2, fontWeight: 900 }}>AXN Mining</h2>
      <div style={{ background: "linear-gradient(145deg, #15171c 0%, #0d0e11 100%)", borderRadius: 18, padding: 16, border: "1px solid rgba(37,99,235,.18)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: "#8e8e93", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Mining status</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: isActive ? "#39ff14" : "#8e8e93", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? "#39ff14" : "#6b7280", boxShadow: isActive ? "0 0 8px #39ff14" : "none" }} />{status}
          </span>
        </div>

        <div style={{ minHeight: 216, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <img src="/assets/axionet-mining.webp" alt="AXIONET" style={{ width: "min(58vw, 220px)", height: "min(58vw, 220px)", objectFit: "contain", animation: isActive ? "axionet-float 2.4s ease-in-out infinite, axionet-glow 1.8s ease-in-out infinite" : "axionet-float 4s ease-in-out infinite", transition: "filter .3s ease" }} />
          <div style={{ color: "#fff", fontSize: "clamp(27px, 8vw, 42px)", fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", marginTop: 5 }}>{amount.toFixed(6)} <span style={{ fontSize: 13, color: "rgba(255,255,255,.62)", letterSpacing: ".12em" }}>AXN</span></div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, margin: "4px 0 12px", color: "#8e8e93", fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
          <span>{ratePerHour.toFixed(4)} AXN / hour</span>
          <span>{isActive ? <><Clock size={11} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />{formatCountdown(remainingSeconds)}</> : "1-hour cycle"}</span>
        </div>
        <div style={{ height: 3, width: "100%", background: "rgba(255,255,255,.08)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}><div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#2563eb,#60a5fa)", transition: "width .5s linear" }} /></div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.06)" }}>
          {!isActive ? (
            <button type="button" onClick={() => startMutation.mutate()} disabled={!canStart} className="active:scale-[0.98] transition-transform" style={{ gridColumn: "1 / -1", height: 44, border: 0, borderRadius: 12, background: canStart ? "#007aff" : "rgba(0,122,255,.25)", color: "#fff", opacity: canStart ? 1 : .62, fontSize: 11, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>{startMutation.isPending ? <Loader2 size={15} className="inline animate-spin" /> : <><Pickaxe size={15} className="inline mr-2" />Start mining</>}</button>
          ) : (
            <>
              <button type="button" onClick={() => boostMutation.mutate()} disabled={!canBoost} className="active:scale-[0.98] transition-transform" style={{ height: 44, border: 0, borderRadius: 12, background: canBoost ? "linear-gradient(135deg,#2563eb,#3b82f6)" : "rgba(37,99,235,.25)", color: "#fff", opacity: canBoost ? 1 : .62, fontSize: 11, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>{boostMutation.isPending ? <Loader2 size={15} className="inline animate-spin" /> : <><Rocket size={15} className="inline mr-2" />Boost</>}</button>
              <button type="button" onClick={() => claimMutation.mutate()} disabled={!canClaim} className="active:scale-[0.98] transition-transform" style={{ height: 44, border: 0, borderRadius: 12, background: canClaim ? "#007aff" : "rgba(0,122,255,.25)", color: "#fff", opacity: canClaim ? 1 : .62, fontSize: 11, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>{claimMutation.isPending ? <Loader2 size={15} className="inline animate-spin" /> : <><HandCoins size={15} className="inline mr-2" />Claim</>}</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
