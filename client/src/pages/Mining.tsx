import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Rocket } from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { showAdgramAd } from "@/lib/showAd";
import MenuPopup from "@/components/GameMenuPopup";
import Header from "@/components/GameHeader";
import BottomNav from "@/components/BottomNav";

const FARM_RATE = 23.9574;
const FARM_DURATION = 3600;
const FARM_BOOSTS = [1, 2, 4, 8, 10, 15, 20, 25];

function fmtCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Mining() {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [farmCountdown, setFarmCountdown] = useState(FARM_DURATION);
  const [farmAccum, setFarmAccum] = useState(0);
  const [showFarmInfo, setShowFarmInfo] = useState(false);
  const [showBoostPopup, setShowBoostPopup] = useState(false);
  const farmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: appConfig } = useQuery<any>({
    queryKey: ["/api/config/app"],
    staleTime: 300000,
    retry: false,
  });
  const { data: farmData, refetch: refetchFarm } = useQuery<any>({
    queryKey: ["/api/farming/state"],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!farmData) return;
    setFarmCountdown(farmData.remainingSeconds ?? FARM_DURATION);
    setFarmAccum(farmData.minedAxn ?? 0);
  }, [farmData]);

  useEffect(() => {
    if (farmIntervalRef.current) clearInterval(farmIntervalRef.current);
    if (!farmData?.isActive) return;
    const rate = farmData.effectiveRate ?? FARM_RATE;
    const maxAxn = (FARM_DURATION / 3600) * rate;
    const goldPerSecond = rate / 3600;
    farmIntervalRef.current = setInterval(() => {
      setFarmCountdown(prev => Math.max(0, prev - 1));
      setFarmAccum(prev => parseFloat(Math.min(prev + goldPerSecond, maxAxn).toFixed(4)));
    }, 1000);
    return () => {
      if (farmIntervalRef.current) clearInterval(farmIntervalRef.current);
    };
  }, [farmData?.isActive, farmData?.startedAt, farmData?.effectiveRate]);

  const farmStartMutation = useMutation({
    mutationFn: async () => {
      await showAdgramAd(appConfig?.adsgramRewardBlockId || "");
      const res = await apiRequest("POST", "/api/farming/start", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to start");
      return data;
    },
    onSuccess: () => {
      showNotification("Mining started", "success");
      refetchFarm();
    },
    onError: (err: any) => showNotification(err?.message || "Failed to start mining", "error"),
  });

  const farmClaimMutation = useMutation({
    mutationFn: async () => {
      await showAdgramAd(appConfig?.adsgramRewardBlockId || "");
      const res = await apiRequest("POST", "/api/farming/claim", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to claim");
      return data;
    },
    onSuccess: (data) => {
      showNotification(`${data.amount} Gold claimed`, "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      refetchFarm();
    },
    onError: (err: any) => showNotification(err?.message || "Failed to claim", "error"),
  });

  const farmBoostMutation = useMutation({
    mutationFn: async () => {
      await showAdgramAd(appConfig?.adsgramRewardBlockId || "");
      const res = await apiRequest("POST", "/api/farming/boost", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to boost mining");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/farming/state"] });
      showNotification(`Mining boosted to ${data.multiplier}x`, "success");
      setShowBoostPopup(false);
    },
    onError: (err: any) => showNotification(err?.message || "Could not boost mining", "error"),
  });

  const isActive = Boolean(farmData?.isActive);
  const isPending = farmStartMutation.isPending || farmClaimMutation.isPending;
  const nextBoost = FARM_BOOSTS[Math.min(FARM_BOOSTS.length - 1, Number(farmData?.boostStep ?? 0) + 1)] ?? 25;

  return (
    <div style={{ height: "100dvh", background: "#090909", display: "flex", flexDirection: "column", overflow: "hidden", width: "100%" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Header onMenuOpen={() => setMenuOpen(true)} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "calc(var(--header-height, 62px) + 18px) 14px 96px" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>Mining</div>
            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 12, marginTop: 4 }}>Start a cycle, collect Gold, and upgrade your mining boost.</div>
          </div>

          <div style={{ background: "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(255,255,255,0.04))", border: "1px solid rgba(96,165,250,0.16)", borderRadius: 18, padding: "16px 16px 14px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src="/assets/gem-icon.png" alt="Gold" style={{ width: 54, height: 54, objectFit: "contain" }} />
              <div>
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>Mining cycle</div>
                <div style={{ color: "#fff", fontSize: 19, fontWeight: 900, marginTop: 4 }}>1 hour · {farmData?.multiplier ?? 1}x boost</div>
              </div>
            </div>
          </div>

          <div style={{ background: "#252525", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 14px" }}>
              <img src="/assets/gem-icon.png" alt="Gold" style={{ width: 50, height: 50, flexShrink: 0, objectFit: "contain" }} />
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <div style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1, display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "clamp(30px, 10vw, 46px)", fontWeight: 800 }}>{farmAccum.toFixed(3).split(".")[0]}</span>
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "clamp(18px, 6vw, 27px)", fontWeight: 700 }}>.{farmAccum.toFixed(3).split(".")[1]}</span>
                  <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, fontWeight: 600, marginLeft: 6 }}>Gold</span>
                </div>
                <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 12, marginTop: 6 }}>{(farmData?.effectiveRate ?? FARM_RATE).toFixed(4)} Gold/hour · {farmData?.multiplier ?? 1}x boost</div>
              </div>
            </div>
            <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button onClick={() => setShowFarmInfo(true)} style={{ flex: 1, padding: "13px 0", background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, fontWeight: 800 }} className="active:scale-95 transition-transform"><Info size={18} /> INFO</button>
              <div style={{ width: 1, background: "rgba(255,255,255,0.05)" }} />
              <button onClick={() => setShowBoostPopup(true)} style={{ flex: 1, padding: "13px 0", background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, fontWeight: 800 }} className="active:scale-95 transition-transform"><Rocket size={18} /> BOOST</button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            {isPending ? (
              <button disabled style={{ width: "100%", padding: "14px 0", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: 700 }}><span style={{ width: 10, height: 10, marginRight: 7, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.4)", display: "inline-block", animation: "spin 0.7s linear infinite" }} />{farmClaimMutation.isPending ? "Claiming…" : "Starting…"}</button>
            ) : isActive && farmCountdown <= 0 ? (
              <button onClick={() => farmClaimMutation.mutate()} style={{ width: "100%", padding: "14px 0", background: "#16a34a", border: "none", borderRadius: 12, color: "#fff", fontSize: 12, fontWeight: 800 }} className="active:scale-95 transition-transform">CLAIM</button>
            ) : isActive ? (
              <div style={{ width: "100%", padding: "14px 0", background: "#eab308", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "#fff", fontSize: 12, fontWeight: 800 }}><span>MINING · {fmtCountdown(farmCountdown)}</span></div>
            ) : (
              <button onClick={() => farmStartMutation.mutate()} style={{ width: "100%", padding: "14px 0", background: "#dc2626", border: "none", borderRadius: 12, color: "#fff", fontSize: 12, fontWeight: 800 }} className="active:scale-95 transition-transform">START MINING</button>
            )}
          </div>

          {showFarmInfo && (
            <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "flex-end" }}>
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} onClick={() => setShowFarmInfo(false)} />
              <div style={{ position: "relative", width: "100%", background: "linear-gradient(160deg, #0d0d0f, #111118)", borderRadius: "28px 28px 0 0", padding: "28px 20px max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))" }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", margin: "0 auto 24px" }} />
                <div style={{ color: "#fff", fontSize: 19, fontWeight: 900, textAlign: "center", marginBottom: 22 }}>Mining Info</div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "4px 0", marginBottom: 20 }}>
                  {[{ label: "Mining speed", val: "23.9574 Gold/hour" }, { label: "Cycle duration", val: "1 hour" }, { label: "Base per cycle", val: "23.9574 Gold" }, { label: "Claim", val: "After 1 hour only" }, { label: "Boost levels", val: "1x → 25x" }].map((row, i, rows) => <div key={row.label}><div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px" }}><span style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>{row.label}</span><span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{row.val}</span></div>{i < rows.length - 1 && <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />}</div>)}
                </div>
                <button onClick={() => setShowFarmInfo(false)} style={{ width: "100%", padding: "14px 0", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 800 }}>Got it</button>
              </div>
            </div>
          )}

          {showBoostPopup && (
            <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "flex-end" }}>
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} onClick={() => setShowBoostPopup(false)} />
              <div style={{ position: "relative", width: "100%", background: "linear-gradient(160deg, #0d0d0f, #111118)", borderRadius: "28px 28px 0 0", padding: "28px 20px max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))", textAlign: "center" }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", margin: "0 auto 24px" }} />
                <div style={{ color: "#fff", fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Upgrade multiplier</div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}><div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, textTransform: "uppercase" }}>Current boost</div><div style={{ color: "#c084fc", fontSize: 24, fontWeight: 900 }}>{farmData?.multiplier ?? 1}x</div><div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 3 }}>Watch an ad to unlock the next level: {nextBoost}x</div></div>
                <button onClick={() => farmBoostMutation.mutate()} disabled={!isActive || farmBoostMutation.isPending || Number(farmData?.multiplier ?? 1) >= 25} style={{ width: "100%", padding: "14px 0", background: "linear-gradient(135deg, #2563eb, #3b82f6)", border: 0, borderRadius: 14, color: "#fff", fontSize: 14, fontWeight: 800, opacity: (!isActive || farmBoostMutation.isPending || Number(farmData?.multiplier ?? 1) >= 25) ? 0.45 : 1 }}>{farmBoostMutation.isPending ? "Watching ad…" : Number(farmData?.multiplier ?? 1) >= 25 ? "Maximum boost reached" : "Watch ad to boost"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
      <BottomNav />
    </div>
  );
}
