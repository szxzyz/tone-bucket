import { useEffect, useState } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";

const AXN_PER_USD = 100_000;
const AXN_PRICE_USD = 1 / AXN_PER_USD;
const formatAxn = (value: number) => (Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const formatUsd = (value: number, digits = 4) => `$${(Number.isFinite(value) ? value : 0).toFixed(digits)}`;

const bluePill: React.CSSProperties = {
  minWidth: 0, height: 38, boxSizing: "border-box", padding: "0 12px", borderRadius: 12,
  background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontSize: 11,
  fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 8, boxShadow: "0 7px 18px rgba(37,99,235,.18)",
};
const mutedPill: React.CSSProperties = { ...bluePill, background: "rgba(255,255,255,.06)", color: "rgba(255,255,255,.58)", boxShadow: "none" };

export default function GameFarmingSection() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 10_000 });
  const { data: farm, isLoading } = useQuery<any>({ queryKey: ["/api/farming/state"], retry: false, staleTime: 10_000, refetchInterval: 30_000 });
  const [amount, setAmount] = useState(0);
  const [tokenTapped, setTokenTapped] = useState(false);
  useEffect(() => setAmount(Number(farm?.minedGold ?? farm?.minedAxn ?? 0)), [farm]);
  const ratePerHour = Math.max(0, Number(farm?.effectiveRate ?? farm?.baseRatePerHour ?? 23.9574));
  const isActive = Boolean(farm?.isActive);
  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setAmount((current) => current + ratePerHour / 3600), 1000);
    return () => window.clearInterval(timer);
  }, [isActive, ratePerHour]);
  const claimMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/farming/claim", {});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not claim AXN");
      return data;
    },
    onSuccess: (data) => {
      showNotification(`${formatAxn(Number(data.amount || 0))} AXN claimed`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
    },
    onError: (error: any) => showNotification(error?.message || "Could not claim AXN", "error"),
  });
  const totalAssets = Math.max(0, Number(user?.balance ?? 0));
  const miningUsd = Math.max(0, amount / AXN_PER_USD);
  const claimLabel = `CLAIM +${formatAxn(amount)} AXN (${formatUsd(miningUsd, 4)})`;
  const tapToken = () => {
    setTokenTapped(true);
    window.setTimeout(() => setTokenTapped(false), 520);
  };

  return (
    <>
      <style>{`
        @keyframes axnFloat { 0%,100% { transform: translateY(0) rotate(-1deg) scale(1); } 50% { transform: translateY(-7px) rotate(1deg) scale(1.025); } }
        @keyframes axnGlow { 0%,100% { filter: drop-shadow(0 0 9px rgba(0,210,255,.75)) drop-shadow(0 0 24px rgba(0,170,255,.32)); } 50% { filter: drop-shadow(0 0 16px rgba(0,235,255,1)) drop-shadow(0 0 38px rgba(0,170,255,.62)); } }
        @keyframes axnTap { 0% { transform: scale(1); } 35% { transform: scale(.9) rotate(-4deg); } 70% { transform: scale(1.1) rotate(4deg); } 100% { transform: scale(1); } }
        .axn-token { animation: axnFloat 3.2s ease-in-out infinite, axnGlow 2.1s ease-in-out infinite; transition: transform .18s ease; }
        .axn-token.tapped { animation: axnTap .52s cubic-bezier(.2,.8,.25,1), axnGlow .52s ease-in-out; }
      `}</style>
      <section aria-labelledby="mining-card-title" style={{ marginBottom: 18, color: "#fff" }}>
      <div style={{ ...bluePill, width: "100%", marginBottom: 8 }}><span>AXN Token Price</span><strong style={{ fontSize: 12 }}>{formatUsd(AXN_PRICE_USD, 6)}</strong></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={bluePill}><span>Lvl</span><span style={{ fontSize: 10, opacity: .74 }}>Coming soon</span></div>
        <div style={bluePill}><span>Yield:</span><span style={{ fontSize: 10, opacity: .74 }}>Coming soon</span></div>
      </div>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>TOTAL ASSETS <span style={{ color: "rgba(255,255,255,.38)", letterSpacing: 0 }}>({formatUsd(totalAssets / AXN_PER_USD, 2)} USD value)</span></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 7 }}><img src="/assets/axionet-mining.webp" alt="AXN" style={{ width: 25, height: 25, objectFit: "contain" }} /><strong style={{ color: "#fff", fontSize: "clamp(22px, 7vw, 30px)", lineHeight: 1, letterSpacing: "-.035em" }}>{formatAxn(totalAssets)} <span style={{ color: "#13d7ee", fontSize: 16 }}>AXN</span></strong></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 13 }}>
        <div style={mutedPill}><span>Holding</span><span style={{ color: "#fff", fontSize: 10 }}>Coming soon</span></div>
        <div style={mutedPill}><span>Pool</span><span style={{ color: "#fff", fontSize: 10 }}>Coming soon</span></div>
      </div>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ color: "#10d9f2", fontSize: "clamp(30px, 10vw, 44px)", fontWeight: 900, lineHeight: 1, letterSpacing: ".01em", textShadow: "0 0 18px rgba(0,210,255,.3)" }}>+{formatAxn(amount)}</div>
        <div style={{ color: "rgba(255,255,255,.58)", fontSize: 12, marginTop: 5 }}>= {formatUsd(miningUsd, 4)} USD</div>
      </div>
      <div onClick={tapToken} onPointerDown={() => setTokenTapped(true)} onPointerUp={() => window.setTimeout(() => setTokenTapped(false), 520)} role="button" tabIndex={0} aria-label="Tap AXN token" style={{ display: "flex", justifyContent: "center", alignItems: "center", margin: "5px auto 22px", height: 164, cursor: "pointer" }}><img className={tokenTapped ? "axn-token tapped" : "axn-token"} src="/assets/axionet-mining.webp" alt="AXN mining token" style={{ width: 150, height: 150, objectFit: "contain" }} /></div>
      <button type="button" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending || isLoading} style={{ display: "block", width: "92%", maxWidth: 360, margin: "0 auto", height: 44, border: 0, borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontSize: 11, fontWeight: 900, letterSpacing: ".025em", boxShadow: "0 8px 20px rgba(37,99,235,.28)", opacity: claimMutation.isPending || isLoading ? .65 : 1 }}>{claimMutation.isPending ? <Loader2 size={17} className="animate-spin" style={{ margin: "0 auto" }} /> : <><HandCoins size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {claimLabel}</>}</button>
      <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 16, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,.25)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><div><div style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>Package Lvl 1 <span style={{ color: "#12d8ef", fontWeight: 700 }}>Coming soon</span></div><div style={{ color: "rgba(255,255,255,.42)", fontSize: 10, marginTop: 4 }}>{isActive ? `${ratePerHour.toFixed(4)} AXN/hour · Mining active` : "Mining initializing…"}</div></div><span style={{ width: 7, height: 7, borderRadius: "50%", background: isActive ? "#12d8ef" : "#64748b", boxShadow: isActive ? "0 0 10px #12d8ef" : "none", flexShrink: 0 }} /></div>
    </section>
    </>
  );
}
