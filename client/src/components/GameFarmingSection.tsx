import { useEffect, useState } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";

const AXN_PER_USD = 100_000;
const formatAxn = (value: number) => (Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const formatUsd = (value: number, digits = 4) => `$${(Number.isFinite(value) ? value : 0).toFixed(digits)}`;

const glassPill: React.CSSProperties = {
  minWidth: 0, height: 38, boxSizing: "border-box", padding: "0 12px", borderRadius: 12,
  background: "rgba(255,255,255,.055)", color: "#fff", fontSize: 11,
  fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
  gap: 8, border: "1px solid rgba(255,255,255,.16)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.08), 0 7px 18px rgba(0,0,0,.12)",
};
const mutedPill: React.CSSProperties = { ...glassPill, background: "rgba(255,255,255,.045)", color: "rgba(255,255,255,.62)", boxShadow: "none" };

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
  const totalAssets = Math.max(0, Number(user?.balance ?? 0));
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
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ color: "rgba(255,255,255,.62)", fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>TOTAL ASSETS <span style={{ color: "rgba(255,255,255,.38)", letterSpacing: 0 }}>({formatUsd(totalAssets / AXN_PER_USD, 2)} USD value)</span></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 7 }}><img src="/assets/axionet-mining.webp" alt="AXN" style={{ width: 25, height: 25, objectFit: "contain" }} /><strong style={{ color: "#fff", fontSize: "clamp(20px, 6vw, 27px)", lineHeight: 1, letterSpacing: "-.035em" }}>{Math.round(totalAssets).toLocaleString("en-US")} <span style={{ color: "#fff", fontSize: 14 }}>AXN</span></strong></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
        <div style={mutedPill}><span>Holding</span><span style={{ color: "#fff", fontSize: 10 }}>Coming soon</span></div>
        <div style={mutedPill}><span>Pool</span><span style={{ color: "#fff", fontSize: 10 }}>Coming soon</span></div>
      </div>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ color: "#fff", fontSize: "clamp(27px, 9vw, 39px)", fontWeight: 900, lineHeight: 1, letterSpacing: ".01em", textShadow: "0 0 14px rgba(255,255,255,.18)" }}>+{formatAxn(amount)}</div>
        <div style={{ color: "rgba(255,255,255,.58)", fontSize: 12, marginTop: 5 }}>= {formatUsd(miningUsd, 4)} USD</div>
      </div>
      <div onPointerDown={tapToken} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") tapToken(); }} role="button" tabIndex={0} aria-label="Tap AXN token" style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", margin: "34px auto 48px", height: 164, cursor: "pointer" }}><img className={tokenTapped ? "axn-token tapped" : "axn-token"} src="/assets/axionet-mining.webp" alt="AXN mining token" style={{ width: 150, height: 150, objectFit: "contain" }} />{showBurst && <div aria-hidden="true">{[["-56px","-42px"],["0px","-68px"],["56px","-42px"],["68px","8px"],["-68px","8px"],["-42px","54px"],["42px","54px"]].map(([x,y]) => <span key={`${x}-${y}`} className="axn-point" style={{ "--x": x, "--y": y } as React.CSSProperties} />)}</div>}</div>
      <button type="button" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending || isLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "calc(100% - 28px)", margin: "0 auto", height: 50, border: "none", borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", cursor: "pointer", boxShadow: "0 8px 20px rgba(37,99,235,.28)", opacity: claimMutation.isPending || isLoading ? .65 : 1 }}>{claimMutation.isPending ? <Loader2 size={15} className="animate-spin" style={{ margin: "0 auto" }} /> : <><HandCoins size={16} /> Claim</>}</button>

    </section>
    </>
  );
}
