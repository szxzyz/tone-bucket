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
    setRemainingSeconds(Number(farm?.remainingSeconds ?? 0));
  }, [farm]);

  const ratePerHour = Math.max(0, Number(farm?.effectiveRate ?? BASE_RATE_PER_HOUR));
  const isActive = Boolean(farm?.isActive);
  const isComplete = isActive && (Boolean(farm?.isComplete) || remainingSeconds <= 0);
  const isRunning = isActive && !isComplete;
  const progress = isActive ? Math.min(100, Math.max(0, ((CYCLE_SECONDS - remainingSeconds) / CYCLE_SECONDS) * 100)) : 0;

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
      showNotification("RIG RUNNING — AXN mining started", "success");
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
    },
    onError: (error: any) => showNotification(error?.message || "Could not boost mining", "error"),
  });

  const pending = startMutation.isPending || claimMutation.isPending || boostMutation.isPending;
  const rigStatus = isLoading ? "LOADING" : isComplete ? "RIG COMPLETE" : isRunning ? "RIG RUNNING" : "RIG OFFLINE";
  const canStart = !isLoading && !isActive && !pending;
  const canClaim = isComplete && !pending;
  const canBoost = isRunning && !pending;
  const primaryLabel = startMutation.isPending
    ? "Starting…"
    : claimMutation.isPending
      ? "Collecting…"
      : isComplete
        ? "Collect"
        : isRunning
          ? `Mining in Progress ${Math.round(progress)}%`
          : "Start";

  return (
    <section style={{ position: "relative", width: "100%", padding: "28px 0 20px" }} aria-labelledby="farming-title">
      <style>{`@keyframes axionet-float { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-7px) scale(1.025); } } @keyframes axionet-glow { 0%,100% { filter: drop-shadow(0 0 8px rgba(0,122,255,.2)); } 50% { filter: drop-shadow(0 0 28px rgba(0,122,255,.85)); } }`}</style>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "min(44vh, 340px)" }}>
        <img src="/assets/axionet-mining.webp" alt="AXIONET" style={{ width: "min(60vw, 230px)", height: "min(60vw, 230px)", objectFit: "contain", animation: isRunning ? "axionet-float 2.4s ease-in-out infinite, axionet-glow 1.8s ease-in-out infinite" : "axionet-float 4s ease-in-out infinite", transition: "filter .3s ease" }} />
      </div>

      <div style={{ textAlign: "center", marginTop: -8 }}>
        <div id="farming-title" style={{ color: isRunning ? "#39ff14" : isComplete ? "#60a5fa" : "rgba(255,255,255,.55)", fontSize: 12, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 10 }}>{rigStatus}</div>
        <div style={{ color: "#fff", fontSize: "clamp(32px, 10vw, 48px)", fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{amount.toFixed(4)} <span style={{ fontSize: 14, color: "rgba(255,255,255,.62)", letterSpacing: ".12em" }}>AXN</span></div>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 7, marginTop: 14, color: "rgba(255,255,255,.58)", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          <span>{isRunning ? <><Clock size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />{formatCountdown(remainingSeconds)} Left</> : isComplete ? "Cycle complete" : "Ready to mine"}</span>
          <span>•</span>
          <span>{ratePerHour.toFixed(2)} AXN / hour</span>
        </div>
        {isRunning && <div style={{ maxWidth: 420, margin: "18px auto 0", padding: "0 10px" }}><div style={{ height: 5, background: "rgba(255,255,255,.1)", borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#2563eb,#60a5fa)", transition: "width .5s linear" }} /></div><div style={{ color: "rgba(255,255,255,.42)", fontSize: 10, fontWeight: 800, marginTop: 7, letterSpacing: ".08em" }}>MINING IN PROGRESS · {Math.round(progress)}%</div></div>}
      </div>

      <div style={{ margin: "24px auto 0", width: "100%", maxWidth: 420 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button type="button" onClick={() => boostMutation.mutate()} disabled={!canBoost} className="active:scale-[0.98] transition-transform" style={{ height: 48, border: 0, borderRadius: 14, background: canBoost ? "linear-gradient(135deg,#2563eb,#3b82f6)" : "rgba(255,255,255,.1)", color: canBoost ? "#fff" : "rgba(255,255,255,.38)", fontSize: 11, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", boxShadow: canBoost ? "0 8px 24px rgba(37,99,235,.3)" : "none" }}>{boostMutation.isPending ? <Loader2 size={15} className="inline animate-spin" /> : <><Rocket size={15} className="inline mr-2" />Boost</>}</button>
          <button type="button" onClick={() => isComplete ? claimMutation.mutate() : startMutation.mutate()} disabled={(!canStart && !canClaim) || pending} className="active:scale-[0.98] transition-transform" style={{ height: 48, border: 0, borderRadius: 14, background: canStart || canClaim ? "#007aff" : "rgba(255,255,255,.1)", color: canStart || canClaim ? "#fff" : "rgba(255,255,255,.38)", fontSize: 11, fontWeight: 900, letterSpacing: ".07em", textTransform: "uppercase", boxShadow: canStart || canClaim ? "0 8px 24px rgba(0,122,255,.28)" : "none" }}>{startMutation.isPending || claimMutation.isPending ? <Loader2 size={15} className="inline animate-spin" /> : isComplete ? <><HandCoins size={15} className="inline mr-2" />{primaryLabel}</> : isRunning ? primaryLabel : <><Pickaxe size={15} className="inline mr-2" />{primaryLabel}</>}</button>
        </div>
      </div>
    </section>
  );
}
