import { useEffect, useState } from "react";
import { HandCoins, Loader2, Activity, Clock3, Layers3, Home, Link2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";

const AXN_PER_USD = 100_000;
const formatAxn = (value: number) => (Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const formatAxnSix = (value: number) => (Number.isFinite(value) ? value : 0).toFixed(6);

const glassPill: React.CSSProperties = {
  minWidth: 0, height: 38, boxSizing: "border-box", padding: "0 12px", borderRadius: 12,
  background: "rgba(255,255,255,.055)", color: "#fff", fontSize: 11,
  fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
  gap: 8, border: "1px solid rgba(255,255,255,.16)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), 0 7px 18px rgba(0,0,0,.12)",
};

export default function GameFarmingSection() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 10_000 });
  const { data: farm, isLoading } = useQuery<any>({ queryKey: ["/api/farming/state"], retry: false, staleTime: 10_000, refetchInterval: 30_000 });
  const [amount, setAmount] = useState(0);
  const [tokenTapped, setTokenTapped] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
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
  const miningUsd = Math.max(0, amount / AXN_PER_USD);
  const tapToken = () => {
    setTokenTapped(true);
    setShowBurst(true);
    window.setTimeout(() => setTokenTapped(false), 520);
    window.setTimeout(() => setShowBurst(false), 700);
  };

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
        <div style={glassPill}><span>Lvl</span><span style={{ fontSize: 10, opacity: .74 }}>Coming soon</span></div>
        <div style={glassPill}><span>Yield:</span><span style={{ fontSize: 10, opacity: .74 }}>Coming soon</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 36, padding: "0 10px", borderRadius: 12, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 4px 12px rgba(0,0,0,.18)", color: "rgba(255,255,255,.62)", fontSize: 11, fontWeight: 700 }}>Holding: <span style={{ color: "rgba(255,255,255,.38)", marginLeft: 4 }}>Coming soon</span></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 36, padding: "0 10px", borderRadius: 12, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 4px 12px rgba(0,0,0,.18)", color: "rgba(255,255,255,.62)", fontSize: 11, fontWeight: 700 }}>Pool: <span style={{ color: "rgba(255,255,255,.38)", marginLeft: 4 }}>Coming soon</span></div>
      </div>
      <div onPointerDown={tapToken} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") tapToken(); }} role="button" tabIndex={0} aria-label="Tap AXN token" style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", margin: "5px auto 22px", height: 164, cursor: "pointer" }}><img className={tokenTapped ? "axn-token tapped" : "axn-token"} src="/assets/axionet-mining.webp" alt="AXN mining token" style={{ width: 150, height: 150, objectFit: "contain" }} />{showBurst && <div aria-hidden="true">{[["-56px","-42px"],["0px","-68px"],["56px","-42px"],["68px","8px"],["-68px","8px"],["-42px","54px"],["42px","54px"]].map(([x,y]) => <span key={`${x}-${y}`} className="axn-point" style={{ "--x": x, "--y": y } as React.CSSProperties} />)}</div>}</div>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 }}>Unclaimed reward</div>
        <div style={{ color: "#fff", fontSize: "clamp(22px, 7vw, 30px)", fontWeight: 900, lineHeight: 1, letterSpacing: ".01em" }}>{formatAxnSix(amount)} <span style={{ fontSize: 14, fontWeight: 800 }}>AXN</span></div>
        <div style={{ color: "rgba(255,255,255,.58)", fontSize: 12, marginTop: 5 }}>= {miningUsd.toFixed(4)}</div>
      </div>
      <button type="button" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending || isLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "calc(100% - 28px)", margin: "0 auto", height: 44, border: "none", borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", cursor: "pointer", boxShadow: "0 8px 20px rgba(37,99,235,.28)", opacity: claimMutation.isPending || isLoading ? .65 : 1 }}>{claimMutation.isPending ? <Loader2 size={15} className="animate-spin" style={{ margin: "0 auto" }} /> : <><HandCoins size={16} /> Claim Reward {Number(amount).toFixed(2)} AXN</>}</button>
      <section aria-label="Miner details" style={{ marginTop: 16 }}>
        <div style={{ color: "rgba(255,255,255,.42)", fontSize: 11, fontWeight: 700, margin: "0 0 6px 4px", letterSpacing: ".04em" }}>Miner:</div>
        <div style={{ borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(37,99,235,.12)", color: "#60a5fa" }}><Activity size={16} /></div>
            <span style={{ flex: 1, color: "#fff", fontSize: 13, fontWeight: 700 }}>Mining Speed</span>
            <strong style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>{ratePerHour.toFixed(2)} AXN/hr</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(59,130,246,.12)", color: "#93c5fd" }}><Clock3 size={16} /></div>
            <span style={{ flex: 1, color: "#fff", fontSize: 13, fontWeight: 700 }}>24h Output</span>
            <strong style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>{(ratePerHour * 24).toFixed(2)} AXN</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(96,165,250,.12)", color: "#bfdbfe" }}><Layers3 size={16} /></div>
            <span style={{ flex: 1, color: "#fff", fontSize: 13, fontWeight: 700 }}>Level</span>
            <strong style={{ color: "rgba(255,255,255,.38)", fontSize: 11, fontWeight: 700 }}>Coming soon</strong>
          </div>
          <div style={{ padding: "9px 12px 11px", color: "rgba(255,255,255,.32)", fontSize: 11 }}>Claim within 24 hours to keep mining active</div>
        </div>
      </section>

      <section aria-label="My holdings" style={{ marginTop: 12 }}>
        <div style={{ color: "rgba(255,255,255,.42)", fontSize: 11, fontWeight: 700, margin: "0 0 6px 4px", letterSpacing: ".04em" }}>My holdings</div>
        <div style={{ borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(37,99,235,.12)", color: "#60a5fa" }}><Home size={16} /></div>
            <span style={{ flex: 1, color: "#fff", fontSize: 13, fontWeight: 700 }}>In app</span>
            <strong style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>{Math.round(Number(user?.balance ?? 0)).toLocaleString("en-US")} AXN</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px" }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(59,130,246,.12)", color: "#93c5fd" }}><Link2 size={16} /></div>
            <span style={{ flex: 1, color: "#fff", fontSize: 13, fontWeight: 700 }}>GRAM Wallet</span>
            <strong style={{ color: "rgba(255,255,255,.38)", fontSize: 11, fontWeight: 700 }}>Coming soon</strong>
          </div>
        </div>
      </section>

      <section aria-label="AXN Live chart" style={{ marginTop: 14, padding: "14px 14px 10px", borderRadius: 14, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><span style={{ color: "rgba(255,255,255,.7)", fontSize: 12, fontWeight: 900 }}>AXN Live chart</span><span style={{ color: "#86efac", fontSize: 10, fontWeight: 800 }}>Live · $0.000010</span></div>
        <svg viewBox="0 0 320 70" width="100%" height="70" role="img" aria-label="AXN live price trend" preserveAspectRatio="none">
          <defs><linearGradient id="axnChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity=".35" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs>
          <path d="M0 58 L24 54 L48 57 L72 42 L96 47 L120 35 L144 40 L168 27 L192 33 L216 22 L240 30 L264 17 L288 24 L320 10 L320 70 L0 70 Z" fill="url(#axnChartFill)" />
          <path d="M0 58 L24 54 L48 57 L72 42 L96 47 L120 35 L144 40 L168 27 L192 33 L216 22 L240 30 L264 17 L288 24 L320 10" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </section>

    </section>
    </>
  );
}
