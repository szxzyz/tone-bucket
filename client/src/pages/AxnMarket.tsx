import { useMemo, useState } from "react";
import { ArrowLeft, CandlestickChart, Check, LockKeyhole, RefreshCw, Settings2, ShieldCheck, X } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { useAdmin } from "@/hooks/useAdmin";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";

const TIMEFRAMES = ["1H", "24H", "7D", "30D"] as const;
type Timeframe = typeof TIMEFRAMES[number];
type Side = "buy" | "sell";
const card = { borderRadius: 16, background: "linear-gradient(145deg,#1a1c20,#101114)", boxShadow: "0 8px 24px rgba(0,0,0,.28)" } as const;
const fmt = (value: unknown, digits = 8) => { const n = Number(value); return Number.isFinite(n) ? n.toFixed(digits) : "—"; };

export default function AxnMarket() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { isAdmin, role, permissions, isLoading: adminLoading } = useAdmin();
  const [timeframe, setTimeframe] = useState<Timeframe>("24H");
  const [side, setSide] = useState<Side>(new URLSearchParams(window.location.search).get("side") === "sell" ? "sell" : "buy");
  const [inputAmount, setInputAmount] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<any>({});
  const canTrade = isAdmin && (role === "super_admin" || permissions.includes("manage_market" as any));
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/axn-market", timeframe],
    queryFn: async () => { const r = await fetch(`/api/axn-market?timeframe=${timeframe}`); if (!r.ok) throw new Error("Could not load market"); return r.json(); },
    staleTime: 10_000, refetchInterval: 20_000,
  });
  const adminSettings = useQuery<any>({ queryKey: ["/api/admin/axn-market/settings"], enabled: canTrade && showSettings, queryFn: async () => (await apiRequest("GET", "/api/admin/axn-market/settings")).json() });
  const quoteMutation = useMutation({
    mutationFn: async () => { const r = await apiRequest("POST", "/api/axn-market/quote", { side, inputAmount }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Could not calculate quote"); return body; },
    onSuccess: setQuote, onError: (e: any) => showNotification(e.message, "error"),
  });
  const swapMutation = useMutation({
    mutationFn: async () => { const r = await apiRequest("POST", "/api/axn-market/swap", { side, inputAmount, minReceived: quote?.minReceived, idempotencyKey: `${side}-${Date.now()}-${crypto.randomUUID()}` }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Swap failed"); return body; },
    onSuccess: () => { setQuote(null); setInputAmount(""); refetch(); queryClient.invalidateQueries({ queryKey: ["/api/admin/axn-market/settings"] }); showNotification("Virtual swap completed", "success"); },
    onError: (e: any) => showNotification(e.message, "error"),
  });
  const candles = data?.candles || [];
  const chart = useMemo(() => {
    if (!candles.length) return null;
    const width = 340, height = 170, pad = 18;
    const prices = candles.flatMap((c: any) => [Number(c.high), Number(c.low)]);
    const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(max - min, max * 0.01 || 0.000001);
    const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(candles.length - 1, 1);
    const y = (v: number) => pad + ((max - v) / span) * (height - pad * 2);
    return { width, height, x, y, bodyWidth: Math.max(3, Math.min(12, (width - pad * 2) / Math.max(candles.length, 1) * .55)) };
  }, [candles]);
  const saveSettings = async () => {
    try { const r = await apiRequest("PUT", "/api/admin/axn-market/settings", { ...settingsForm, buyFeeBps: Number(settingsForm.buyFeeBps || 0) * 100, sellFeeBps: Number(settingsForm.sellFeeBps || 0) * 100, maxPriceImpactBps: Number(settingsForm.maxPriceImpactBps || 0) * 100, slippageBps: Number(settingsForm.slippageBps || 0) * 100, marketPaused: settingsForm.marketPaused === true || settingsForm.marketPaused === "true", publicTradingEnabled: settingsForm.publicTradingEnabled === true || settingsForm.publicTradingEnabled === "true" }); const body = await r.json(); if (!r.ok) throw new Error(body.message || "Could not save settings"); showNotification("Market settings saved", "success"); setShowSettings(false); refetch(); } catch (e: any) { showNotification(e.message, "error"); }
  };
  const openSettings = () => { const s = adminSettings.data?.settings || data?.settings || {}; setSettingsForm({ ...s, buyFeeBps: Number(s.buyFeeBps || 30) / 100, sellFeeBps: Number(s.sellFeeBps || 30) / 100, maxPriceImpactBps: Number(s.maxPriceImpactBps || 500) / 100, slippageBps: Number(s.slippageBps || 100) / 100, marketPaused: Boolean(s.marketPaused), publicTradingEnabled: Boolean(s.publicTradingEnabled) }); setShowSettings(true); };
  const currentPrice = data?.price || {};
  const validAmount = /^\d+(?:\.\d{1,18})?$/.test(inputAmount) && Number(inputAmount) > 0;
  return <Layout>
    <main className="max-w-md mx-auto min-h-full px-3 pt-3 pb-24 text-white bg-black">
      <button onClick={() => setLocation("/mining")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: 0, color: "rgba(255,255,255,.65)", padding: "3px 0 12px", fontSize: 12, fontWeight: 800 }}><ArrowLeft size={16} /> Mining</button>
      <section style={{ ...card, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div><div style={{ color: "rgba(255,255,255,.58)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>AXN Virtual Market</div><div style={{ fontSize: 24, fontWeight: 900, marginTop: 5 }}>${fmt(currentPrice.usd, 8)}</div></div><div style={{ color: Number(data?.changePercent) >= 0 ? "#86efac" : "#fca5a5", fontSize: 12, fontWeight: 900 }}>{Number(data?.changePercent || 0) >= 0 ? "+" : ""}{fmt(data?.changePercent, 2)}%</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, margin: "12px 0" }}>{[["TON", currentPrice.ton], ["GRAM", currentPrice.gram], ["TON/USD", currentPrice.tonUsd]].map(([label, value]) => <div key={label} style={{ padding: "8px 6px", borderRadius: 9, background: "rgba(255,255,255,.06)", textAlign: "center" }}><div style={{ color: "rgba(255,255,255,.45)", fontSize: 9, fontWeight: 800 }}>{label}</div><div style={{ color: "#fff", fontSize: 11, fontWeight: 900, marginTop: 3 }}>{fmt(value, label === "TON/USD" ? 4 : 8)}</div></div>)}</div>
        <div style={{ display: "flex", gap: 5, margin: "8px 0 12px" }}>{TIMEFRAMES.map(tf => <button key={tf} onClick={() => setTimeframe(tf)} style={{ flex: 1, height: 30, border: 0, borderRadius: 8, background: timeframe === tf ? "#2563eb" : "rgba(255,255,255,.07)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{tf}</button>)}</div>
        <div style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "rgba(0,0,0,.18)" }}>{isLoading ? <RefreshCw size={18} className="animate-spin" color="#93c5fd" /> : !chart ? <div style={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 12, padding: 20 }}><CandlestickChart size={28} style={{ margin: "0 auto 8px", opacity: .55 }} /><div>No recorded price snapshots yet</div><div style={{ fontSize: 10, marginTop: 4 }}>The chart only appears after a successful authorized virtual swap.</div></div> : <svg viewBox={`0 0 ${chart.width} ${chart.height}`} width="100%" height="180" role="img" aria-label="AXN recorded price chart">{candles.map((c: any, i: number) => { const up = Number(c.close) >= Number(c.open); const color = up ? "#86efac" : "#fca5a5"; const cx = chart.x(i); return <g key={c.time}><line x1={cx} x2={cx} y1={chart.y(Number(c.high))} y2={chart.y(Number(c.low))} stroke={color} strokeWidth="1.5" /><rect x={cx-chart.bodyWidth/2} y={Math.min(chart.y(Number(c.open)),chart.y(Number(c.close)))} width={chart.bodyWidth} height={Math.max(2,Math.abs(chart.y(Number(c.open))-chart.y(Number(c.close))))} fill={color} rx="1" /></g>; })}</svg>}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, color: "rgba(255,255,255,.5)", fontSize: 10 }}><span>Pool: {fmt(data?.pool?.ton, 4)} TON · {fmt(data?.pool?.axn, 0)} AXN</span><span>{data?.swapCount || 0} swaps</span></div>
      </section>
      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,.1)", color: "#fcd34d", fontSize: 11, lineHeight: 1.4, fontWeight: 700 }}>Virtual Market — TON and GRAM are internal accounting balances. No real blockchain transfer is performed.</div>
      <section style={{ ...card, marginTop: 12, padding: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button onClick={() => { setSide("buy"); setQuote(null); }} style={{ flex: 1, height: 38, border: 0, borderRadius: 10, background: side === "buy" ? "#2563eb" : "rgba(255,255,255,.07)", color: "#fff", fontWeight: 900 }}>Buy AXN</button><button onClick={() => { setSide("sell"); setQuote(null); }} style={{ flex: 1, height: 38, border: 0, borderRadius: 10, background: side === "sell" ? "#2563eb" : "rgba(255,255,255,.07)", color: "#fff", fontWeight: 900 }}>Sell AXN</button></div>
        {!canTrade ? <div style={{ textAlign: "center", padding: 14, color: "rgba(255,255,255,.56)", fontSize: 12 }}><LockKeyhole size={18} style={{ margin: "0 auto 6px" }} /><div>{adminLoading ? "Checking access…" : "Trading is Coming Soon for regular users."}</div></div> : <><div style={{ display: "flex", alignItems: "center", gap: 8, color: "#86efac", fontSize: 11, fontWeight: 800, marginBottom: 10 }}><ShieldCheck size={15} /> Authorized admin virtual trading</div><input value={inputAmount} onChange={e => { setInputAmount(e.target.value.replace(/[^0-9.]/g, "")); setQuote(null); }} placeholder={side === "buy" ? "TON amount to spend" : "AXN amount to sell"} inputMode="decimal" style={{ width: "100%", boxSizing: "border-box", height: 42, border: "1px solid rgba(255,255,255,.14)", borderRadius: 10, background: "rgba(0,0,0,.25)", color: "#fff", padding: "0 12px", outline: "none" }} /><button disabled={!validAmount || quoteMutation.isPending} onClick={() => quoteMutation.mutate()} style={{ width: "100%", height: 40, marginTop: 10, border: 0, borderRadius: 10, background: validAmount ? "#2563eb" : "rgba(255,255,255,.1)", color: "#fff", fontWeight: 900 }}>Review quote</button>{quote && <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: "rgba(255,255,255,.06)", fontSize: 12 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span>You pay</span><b>{quote.inputAmount} {quote.inputAsset}</b></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}><span>Estimated receive</span><b>{fmt(quote.netOutput, 8)} {quote.outputAsset}</b></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}><span>Fee</span><b>{fmt(quote.feeAmount, 8)} {quote.inputAsset} ({(Number(quote.feeBps) / 100).toFixed(2)}%)</b></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}><span>Price impact</span><b>{(Number(quote.priceImpactBps) / 100).toFixed(2)}%</b></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}><span>Minimum received</span><b>{fmt(quote.minReceived, 8)} {quote.outputAsset}</b></div><div style={{ display: "flex", gap: 8, marginTop: 10 }}><button onClick={() => swapMutation.mutate()} disabled={swapMutation.isPending} style={{ flex: 1, height: 36, border: 0, borderRadius: 8, background: "#16a34a", color: "#fff", fontWeight: 900 }}><Check size={14} style={{ verticalAlign: "middle" }} /> Confirm</button><button onClick={() => setQuote(null)} style={{ flex: 1, height: 36, border: 0, borderRadius: 8, background: "rgba(255,255,255,.1)", color: "#fff", fontWeight: 800 }}><X size={14} style={{ verticalAlign: "middle" }} /> Cancel</button></div></div>}</>}
      </section>
      <section style={{ ...card, marginTop: 12, padding: 14 }}><div style={{ color: "rgba(255,255,255,.58)", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Recent swaps</div>{!data?.recentSwaps?.length ? <div style={{ color: "rgba(255,255,255,.4)", fontSize: 12 }}>No completed swaps recorded yet.</div> : data.recentSwaps.slice(0, 6).map((swap: any, i: number) => <div key={`${swap.created_at}-${i}`} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: 11 }}><span style={{ color: swap.side === "buy" ? "#86efac" : "#fca5a5", fontWeight: 900 }}>{swap.side.toUpperCase()} {fmt(swap.input_amount, 6)} {swap.input_asset}</span><span style={{ color: "rgba(255,255,255,.6)" }}>{fmt(swap.net_output, 6)} {swap.output_asset}</span></div>)}</section>
      {canTrade && <section style={{ marginTop: 12 }}><button onClick={openSettings} style={{ width: "100%", height: 38, border: 0, borderRadius: 10, background: "rgba(255,255,255,.07)", color: "#fff", fontWeight: 800 }}><Settings2 size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />Admin market settings</button>{showSettings && <div style={{ ...card, marginTop: 8, padding: 14 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{["buyFeeBps","sellFeeBps","minSwapTon","maxSwapTon","minSwapAxn","maxSwapAxn","maxPriceImpactBps","slippageBps","gramUsdPrice"].map(key => <label key={key} style={{ color: "rgba(255,255,255,.6)", fontSize: 10 }}>{key}{["buyFeeBps","sellFeeBps","maxPriceImpactBps","slippageBps"].includes(key) ? " (%)" : ""}<input value={settingsForm[key] ?? ""} onChange={e => setSettingsForm({ ...settingsForm, [key]: e.target.value })} style={{ width: "100%", marginTop: 3, height: 32, color: "#fff", background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 7, padding: "0 7px" }} /></label>)}</div><label style={{ display: "block", marginTop: 10, color: "#fff", fontSize: 11 }}><input type="checkbox" checked={settingsForm.marketPaused === true} onChange={e => setSettingsForm({ ...settingsForm, marketPaused: e.target.checked })} /> Pause market</label><div style={{ display: "flex", gap: 8, marginTop: 10 }}><button onClick={saveSettings} style={{ flex: 1, height: 34, border: 0, borderRadius: 8, background: "#2563eb", color: "#fff", fontWeight: 900 }}>Save</button><button onClick={() => setShowSettings(false)} style={{ flex: 1, height: 34, border: 0, borderRadius: 8, background: "rgba(255,255,255,.1)", color: "#fff", fontWeight: 800 }}>Cancel</button></div></div>}</section>}
    </main>
  </Layout>;
}
