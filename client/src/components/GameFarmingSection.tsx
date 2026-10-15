import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Compass,
  Gauge,
  HandCoins,
  Layers3,
  Loader2,
  ArrowUpFromLine,
  ShoppingCart,
  Timer,
  TrendingUp,
  Waves,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { formatCompactAxn } from "@/lib/formatAxn";
import { showAdsgramRewardAd } from "@/lib/adsgram";
import { useAdSession } from "@/hooks/useAdSession";
import { cancelRegisteredAdSession, confirmProviderCompletion, postWithAdVerification } from "@/lib/adRewardClaim";

const formatAxn = (value: number) => (Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const formatAxnSix = (value: number) => (Number.isFinite(value) ? value : 0).toFixed(6);
const formatCountdown = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((total % 3600) / 60).toString().padStart(2, "0");
  const remainingSeconds = (total % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remainingSeconds}`;
};

const actionPill: React.CSSProperties = {
  minWidth: 0, height: 42, boxSizing: "border-box", padding: "0 10px", borderRadius: 12,
  background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", color: "#fff", fontSize: 12,
  fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center",
  gap: 7, border: "none", boxShadow: "0 5px 14px rgba(0,0,0,.22)",
};

export default function GameFarmingSection() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
  const { data: farm, isLoading, dataUpdatedAt } = useQuery<any>({ queryKey: ["/api/farming/state"], retry: false, staleTime: 10_000, refetchInterval: 30_000 });
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], retry: false, staleTime: 5 * 60_000 });
  const [isShowingClaimAd, setIsShowingClaimAd] = useState(false);
  const [tokenTapped, setTokenTapped] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentLevel = Math.max(1, Number(farm?.currentLevel ?? 1));
  const dailyYield = Math.max(0, Number(farm?.dailyYieldAXN ?? 5));
  const miningPower = Math.max(0, Number(farm?.miningPowerTHs ?? 0.2));
  const eligibleHolding = Math.max(0, Number(farm?.eligibleHolding ?? 0));
  const serverRemainingSeconds = Math.max(0, Number(farm?.remainingSeconds ?? 0));
  const stateAgeSeconds = farm?.serverNow && dataUpdatedAt > 0 ? Math.max(0, (clockNow - dataUpdatedAt) / 1000) : 0;
  const remainingSeconds = Math.max(0, Math.ceil(serverRemainingSeconds - stateAgeSeconds));
  const cycleElapsedSeconds = Math.min(serverRemainingSeconds, stateAgeSeconds);
  const storedAmount = Math.max(0, Number(farm?.minedGold ?? farm?.minedAxn ?? 0));
  const amount = storedAmount + (farm?.isActive ? dailyYield * cycleElapsedSeconds / 86400 : 0);
  const claimBusy = isShowingClaimAd;
  const adsgramBlockId = appConfig?.adsgramRewardBlockId || import.meta.env.VITE_ADSGRAM_BLOCK_ID || "";

  const claimMutation = useMutation({
    mutationFn: async (proof: any) => postWithAdVerification("/api/farming/claim", proof),
    onSuccess: (data: any) => {
      showNotification(`${formatAxn(Number(data.amount || 0))} AXN claimed`, "success");
      const cachedFarm = queryClient.getQueryData<any>(["/api/farming/state"]);
      if (cachedFarm && data.startedAt) {
        queryClient.setQueryData(["/api/farming/state"], {
          ...cachedFarm,
          isActive: true,
          isComplete: false,
          continuous: false,
          startedAt: data.startedAt,
          cycleEndsAt: data.cycleEndsAt,
          cycleDurationSeconds: data.cycleDurationSeconds,
          remainingSeconds: data.remainingSeconds,
          serverNow: data.serverNow,
          minedGold: 0,
          minedAxn: 0,
          currentLevel: data.currentLevel ?? cachedFarm.currentLevel,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not claim AXN", "error"),
  });

  const handleClaim = async () => {
    if (claimBusy || claimMutation.isPending || isLoading || remainingSeconds > 0 || amount <= 0) return;
    setIsShowingClaimAd(true);
    let sessionId: string | null = null;
    let providerCompleted = false;
    let proof: any = null;

    try {
      if (!adsgramBlockId) throw new Error("AdsGram is not configured right now. Please try again later.");

      sessionId = startSession();
      const registration = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: "adsgram",
        context: "mining_claim",
      });
      if (!registration.ok) {
        const details = await registration.json().catch(() => ({}));
        throw new Error(details?.message || "Could not start the AdsGram ad. Please try again.");
      }

      const result = await showAdsgramRewardAd(adsgramBlockId);
      if (result.unavailable) throw new Error("AdsGram is unavailable right now. Please try again later.");
      if (!result.success) throw new Error("Please watch the AdsGram ad completely before claiming.");

      await confirmProviderCompletion(sessionId, "adsgram");
      providerCompleted = true;
      await waitForForeground();
      proof = endSession();
    } catch (error: any) {
      if (sessionId && !providerCompleted) await cancelRegisteredAdSession(sessionId);
      cancelSession();
      showNotification(error?.message || "Could not verify AdsGram completion. Please try again.", "error");
      setIsShowingClaimAd(false);
      return;
    }

    try {
      await claimMutation.mutateAsync(proof);
    } catch {
      // The mutation's onError handler displays the server/verification error.
    } finally {
      setIsShowingClaimAd(false);
    }
  };

  const tapToken = () => {
    setTokenTapped(true);
    setShowBurst(true);
    window.setTimeout(() => setTokenTapped(false), 520);
    window.setTimeout(() => setShowBurst(false), 700);
  };

  const stats = [
    { label: "Level", value: `L${currentLevel}`, color: "#60a5fa", icon: <Layers3 size={15} strokeWidth={2.4} /> },
    { label: "Yield", value: `${dailyYield.toFixed(2)} AXN/day`, color: "#86efac", icon: <TrendingUp size={15} strokeWidth={2.4} /> },
    { label: "Power", value: `${miningPower.toFixed(2)} TH/s`, color: "#fbbf24", icon: <Gauge size={15} strokeWidth={2.4} /> },
    { label: "Pool", value: `${formatCompactAxn(eligibleHolding)} AXN`, color: "#c4b5fd", icon: <Waves size={15} strokeWidth={2.4} /> },
  ];

  const claimPending = claimMutation.isPending;
  const claimDisabled = claimBusy || claimPending || isLoading || remainingSeconds > 0 || amount <= 0;

  return (
    <>
      <style>{`
        @keyframes axnFloat { 0%,100% { transform: translateY(0) rotate(-1deg) scale(1); } 50% { transform: translateY(-7px) rotate(1deg) scale(1.025); } }
        @keyframes axnGlow { 0%,100% { filter: drop-shadow(0 0 10px rgba(37,99,235,.78)) drop-shadow(0 0 24px rgba(37,99,235,.35)); } 50% { filter: drop-shadow(0 0 18px rgba(147,197,253,1)) drop-shadow(0 0 40px rgba(37,99,235,.68)); } }
        @keyframes axnTap { 0% { transform: scale(1); } 35% { transform: scale(.9) rotate(-4deg); } 70% { transform: scale(1.1) rotate(4deg); } 100% { transform: scale(1); } }
        .axn-token { animation: axnFloat 3.2s ease-in-out infinite, axnGlow 2.1s ease-in-out infinite; transition: transform .18s ease; }
        .axn-token.tapped { animation: axnTap .52s cubic-bezier(.2,.8,.25,1), axnGlow .52s ease-in-out; }
        @keyframes axnPoint { 0% { opacity: 1; transform: translate(-50%,-50%) translate(0,0) scale(.25); } 55% { opacity: 1; transform: translate(-50%,-50%) translate(var(--x),var(--y)) scale(1); } 100% { opacity: 0; transform: translate(-50%,-50%) translate(calc(var(--x) * 1.35),calc(var(--y) * 1.35)) scale(.15); } }
        .axn-point { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 999px; background: #93c5fd; box-shadow: 0 0 10px #60a5fa, 0 0 20px rgba(37,99,235,.85); animation: axnPoint .68s cubic-bezier(.2,.8,.25,1) forwards; pointer-events: none; }
      `}</style>
      <section aria-labelledby="mining-card-title" style={{ marginBottom: 18, color: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {stats.slice(0, 2).map((stat) => (
            <div key={stat.label} style={{ ...actionPill, padding: "0 5px", gap: 4 }}>
              <span style={{ color: stat.color, display: "inline-flex", flexShrink: 0 }}>{stat.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>{stat.label}</span>
              <span style={{ fontSize: 12, fontWeight: 900, opacity: .92, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{stat.value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 44 }}>
          {stats.slice(2).map((stat) => (
            <div key={stat.label} style={{ ...actionPill, padding: "0 5px", gap: 4 }}>
              <span style={{ color: stat.color, display: "inline-flex", flexShrink: 0 }}>{stat.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>{stat.label}</span>
              <span style={{ fontSize: 12, fontWeight: 900, opacity: .92, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{stat.value}</span>
            </div>
          ))}
        </div>

        <div onPointerDown={tapToken} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") tapToken(); }} role="button" tabIndex={0} aria-label="Tap AXN token" style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", margin: "5px auto 22px", height: 164, cursor: "pointer" }}>
          <img className={tokenTapped ? "axn-token tapped" : "axn-token"} src="/assets/axionet-mining.webp" alt="AXN mining token" style={{ width: 150, height: 150, objectFit: "contain" }} />
          {showBurst && <div aria-hidden="true">{[["-56px", "-42px"], ["0px", "-68px"], ["56px", "-42px"], ["68px", "8px"], ["-68px", "8px"], ["-42px", "54px"], ["42px", "54px"]].map(([x, y]) => <span key={`${x}-${y}`} className="axn-point" style={{ "--x": x, "--y": y } as React.CSSProperties} />)}</div>}
        </div>

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 }}>Unclaimed reward</div>
          <div style={{ color: "#fff", fontSize: "clamp(22px, 7vw, 30px)", fontWeight: 900, lineHeight: 1, letterSpacing: ".01em" }}>{formatAxnSix(amount)} <span style={{ fontSize: 14, fontWeight: 800 }}>AXN</span></div>
        </div>

        <button type="button" onClick={handleClaim} disabled={claimDisabled} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "calc(100% - 28px)", margin: "0 auto", height: 46, border: "none", borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontWeight: 950, fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em", cursor: claimDisabled ? "default" : "pointer", boxShadow: "0 8px 20px rgba(37,99,235,.28)", opacity: claimDisabled ? .62 : 1 }}>
          {claimBusy || claimPending
            ? <><Loader2 size={15} className="animate-spin" />{claimBusy ? "Opening AdsGram…" : "Claiming AXN…"}</>
            : isLoading
              ? <><Loader2 size={15} className="animate-spin" />Loading mining cycle…</>
              : remainingSeconds > 0
                ? <><Timer size={16} />Mining · {formatCountdown(remainingSeconds)}</>
                : <><HandCoins size={17} />Watch Ad &amp; Claim {Number(amount).toFixed(2)} AXN</>}
        </button>
        <div style={{ color: "rgba(255,255,255,.45)", textAlign: "center", fontSize: 10, fontWeight: 700, marginTop: 7 }}>
          {isLoading ? "Loading your mining cycle…" : remainingSeconds > 0 ? "Claim unlocks when the 3-hour mining cycle ends." : "Complete one AdsGram rewarded ad for each mining claim."}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button type="button" onClick={() => setLocation("/miners")} style={{ ...actionPill, gridColumn: "1 / -1", height: 42, cursor: "pointer" }}><Compass size={17} color="#60a5fa" /> Explore Miners</button>
          <button type="button" onClick={() => setLocation("/axn-market?side=buy")} style={{ ...actionPill, height: 44, cursor: "pointer" }}><ShoppingCart size={17} color="#86efac" /> Buy AXN</button>
          <button type="button" onClick={() => setLocation("/axn-market?side=sell")} style={{ ...actionPill, height: 44, cursor: "pointer" }}><ArrowUpFromLine size={17} color="#fca5a5" /> Sell AXN</button>
        </div>
      </section>
    </>
  );
}
