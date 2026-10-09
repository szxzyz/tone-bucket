import { useMemo, useState } from "react";
import { ArrowLeft, CandlestickChart, Check, LockKeyhole, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { useAdmin } from "@/hooks/useAdmin";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;
type Timeframe = typeof TIMEFRAMES[number];
type Side = "buy" | "sell";
const INITIAL_PRICE = 0.00001;

function formatPrice(value: number) { return value.toFixed(8); }
function formatTon(value: number) { return value.toFixed(6); }

export default function AxnMarket() {
  const [, setLocation] = useLocation();
  const { isAdmin, role, permissions, isLoading: adminLoading } = useAdmin();
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [side, setSide] = useState<Side>(new URLSearchParams(window.location.search).get("side") === "sell" ? "sell" : "buy");
  const [quantity, setQuantity] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const canTrade = isAdmin && (role === "super_admin" || permissions.includes("manage_market" as any));
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/axn-market", timeframe],
    queryFn: async () => { const r = await fetch(`/api/axn-market?timeframe=${timeframe}`); if (!r.ok) throw new Error("Could not load market"); return r.json(); },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const quoteMutation = useMutation({
    mutationFn: async () => { const r = await apiRequest("POST", "/api/axn-market/admin/quote", { side, quantity: Number(quantity) }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Could not quote trade"); return body; },
    onSuccess: setQuote,
    onError: (error: any) => showNotification(error.message, "error"),
  });
  const tradeMutation = useMutation({
    mutationFn: async () => { const r = await apiRequest("POST", "/api/axn-market/admin/trade", { side, quantity: Number(quantity), idempotencyKey: `${side}-${Date.now()}-${crypto.randomUUID()}` }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Trade failed"); return body; },
    onSuccess: () => { setQuote(null); setQuantity(""); refetch(); showNotification("Virtual market trade recorded", "success"); },
    onError: (error: any) => showNotification(error.message, "error"),
  });
  const candles = data?.candles || [];
  const chart = useMemo(() => {
    if (!candles.length) return null;
    const width = 340, height = 170, pad = 18;
    const prices = candles.flatMap((c: any) => [Number(c.high), Number(c.low)]);
    const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(max - min, INITIAL_PRICE * 0.01);
    const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(candles.length - 1, 1);
    const y = (v: number) => pad + ((max - v) / span) * (height - pad * 2);
    const bodyWidth = Math.max(3, Math.min(12, (width - pad * 2) / Math.max(candles.length, 1) * 0.55));
    return { width, height, x, y, bodyWidth };
  }, [candles]);
  const currentPrice = Number(data?.currentPrice || INITIAL_PRICE);
  const change = Number(data?.changePercent || 0);
  const validQuantity = Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0;

  return <Layout>
    <main className="max-w-md mx-auto min-h-full px-3 pt-3 pb-24 text-white bg-black">
      <button onClick={() => setLocation("/mining")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: 0, color: "rgba(255,255,255,.65)", padding: "3px 0 12px", fontSize: 12, fontWeight: 800 }}><ArrowLeft size={16} /> Mining</button>
      <section style={{ borderRadius: 16, background: "linear-gradient(145deg,#1a1c20,#101114)", padding: 16, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><div style={{ color: "rgba(255,255,255,.58)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>AXN Market</div><div style={{ fontSize: 26, fontWeight: 900, marginTop: 5 }}>{formatPrice(currentPrice)} <span style={{ fontSize: 12, color: "rgba(255,255,255,.56)" }}>TON / AXN</span></div></div>
          <div style={{ color: change >= 0 ? "#86efac" : "#fca5a5", fontSize: 12, fontWeight: 900 }}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</div>
        </div>
        <div style={{ display: "flex", gap: 5, margin: "16px 0 12px", overflowX: "auto" }}>{TIMEFRAMES.map((tf) => <button key={tf} onClick={() => setTimeframe(tf)} style={{ flex: 1, minWidth: 42, height: 30, border: 0, borderRadius: 8, background: timeframe === tf ? "#2563eb" : "rgba(255,255,255,.07)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{tf}</button>)}</div>
        <div style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "rgba(0,0,0,.18)" }}>
          {isLoading ? <RefreshCw size={18} className="animate-spin" color="#93c5fd" /> : !chart ? <div style={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 12, padding: 20 }}><CandlestickChart size={28} style={{ margin: "0 auto 8px", opacity: .55 }} /><div>No recorded market data yet</div><div style={{ fontSize: 10, marginTop: 4 }}>The chart will appear after an authorized admin records a trade.</div></div> : <svg viewBox={`0 0 ${chart.width} ${chart.height}`} width="100%" height="180" role="img" aria-label="AXN virtual market candlestick chart">{candles.map((c: any, i: number) => { const up = Number(c.close) >= Number(c.open); const color = up ? "#86efac" : "#fca5a5"; const cx = chart.x(i); return <g key={c.time}><line x1={cx} x2={cx} y1={chart.y(Number(c.high))} y2={chart.y(Number(c.low))} stroke={color} strokeWidth="1.5" /><rect x={cx - chart.bodyWidth / 2} y={Math.min(chart.y(Number(c.open)), chart.y(Number(c.close)))} width={chart.bodyWidth} height={Math.max(2, Math.abs(chart.y(Number(c.open)) - chart.y(Number(c.close))))} fill={color} rx="1" /></g>; })}</svg>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, color: "rgba(255,255,255,.55)", fontSize: 10 }}><span>Trades recorded: {data?.tradeCount || 0}</span><span>1,000 AXN = 0.01 TON initial reference</span></div>
      </section>
      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,.1)", color: "#fcd34d", fontSize: 11, lineHeight: 1.4, fontWeight: 700 }}>Virtual Market — Not a Real TON Market Price. Virtual TON is an internal accounting unit with no guaranteed cash value.</div>
      <section style={{ marginTop: 12, borderRadius: 16, background: "linear-gradient(145deg,#1a1c20,#101114)", padding: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button onClick={() => { setSide("buy"); setQuote(null); }} style={{ flex: 1, height: 38, border: 0, borderRadius: 10, background: side === "buy" ? "#2563eb" : "rgba(255,255,255,.07)", color: "#fff", fontWeight: 900 }}>Buy AXN</button><button onClick={() => { setSide("sell"); setQuote(null); }} style={{ flex: 1, height: 38, border: 0, borderRadius: 10, background: side === "sell" ? "#2563eb" : "rgba(255,255,255,.07)", color: "#fff", fontWeight: 900 }}>Sell AXN</button></div>
        {!canTrade ? <div style={{ textAlign: "center", padding: 12, color: "rgba(255,255,255,.56)", fontSize: 12 }}><LockKeyhole size={18} style={{ margin: "0 auto 6px" }} /><div>{adminLoading ? "Checking access…" : "Trading is Coming Soon for regular users."}</div></div> : <><div style={{ display: "flex", alignItems: "center", gap: 8, color: "#86efac", fontSize: 11, fontWeight: 800, marginBottom: 10 }}><ShieldCheck size={15} /> Authorized admin trading</div><input value={quantity} onChange={(e) => { setQuantity(e.target.value.replace(/[^0-9]/g, "")); setQuote(null); }} placeholder="Whole AXN quantity" inputMode="numeric" style={{ width: "100%", boxSizing: "border-box", height: 42, border: "1px solid rgba(255,255,255,.14)", borderRadius: 10, background: "rgba(0,0,0,.25)", color: "#fff", padding: "0 12px", outline: "none" }} /><button disabled={!validQuantity || quoteMutation.isPending} onClick={() => quoteMutation.mutate()} style={{ width: "100%", height: 40, marginTop: 10, border: 0, borderRadius: 10, background: validQuantity ? "#2563eb" : "rgba(255,255,255,.1)", color: "#fff", fontWeight: 900 }}>Review quote</button>{quote && <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: "rgba(255,255,255,.06)", fontSize: 12 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span>Quote</span><b>{quote.quantity.toLocaleString()} AXN</b></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}><span>Virtual TON</span><b>{formatTon(quote.tonAmount)} TON</b></div><div style={{ display: "flex", gap: 8, marginTop: 10 }}><button onClick={() => tradeMutation.mutate()} disabled={tradeMutation.isPending} style={{ flex: 1, height: 34, border: 0, borderRadius: 8, background: "#16a34a", color: "#fff", fontWeight: 900 }}><Check size={14} style={{ verticalAlign: "middle" }} /> Confirm</button><button onClick={() => setQuote(null)} style={{ flex: 1, height: 34, border: 0, borderRadius: 8, background: "rgba(255,255,255,.1)", color: "#fff", fontWeight: 800 }}><X size={14} style={{ verticalAlign: "middle" }} /> Cancel</button></div></div>}</>}
      </section>
    </main>
  </Layout>;
}
