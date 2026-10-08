import { useEffect, useState } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";

const AXN_PER_USD = 100_000;
const AXN_PRICE_USD = 1 / AXN_PER_USD;

const formatAxn = (value: number) => (Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const formatUsd = (value: number, digits = 4) => `$${(Number.isFinite(value) ? value : 0).toFixed(digits)}`;

const pillStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  borderRadius: 14,
  padding: "10px 12px",
  background: "linear-gradient(145deg, rgba(18,34,54,.9), rgba(8,15,27,.95))",
  border: "1px solid rgba(0,194,255,.25)",
  color: "rgba(255,255,255,.72)",
  fontSize: 11,
  fontWeight: 800,
};

export default function GameFarmingSection() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 10_000 });
  const { data: farm, isLoading } = useQuery<any>({
    queryKey: ["/api/farming/state"],
    retry: false,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    setAmount(Number(farm?.minedGold ?? farm?.minedAxn ?? 0));
  }, [farm]);

  const ratePerHour = Math.max(0, Number(farm?.effectiveRate ?? farm?.baseRatePerHour ?? 23.9574));
  const isActive = Boolean(farm?.isActive);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => {
      setAmount((current) => current + ratePerHour / 3600);
    }, 1000);
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

  return (
    <section aria-labelledby="mining-card-title" style={{ marginBottom: 18 }}>
      <div style={{
        borderRadius: 24,
        padding: "14px 12px 18px",
        background: "radial-gradient(circle at 50% 42%, rgba(0,184,255,.13), transparent 36%), linear-gradient(180deg, #07111d 0%, #03070d 100%)",
        border: "1px solid rgba(0,180,255,.22)",
        boxShadow: "0 14px 45px rgba(0,0,0,.34)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
          <div style={{ ...pillStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>AXN Token Price</span>
            <strong style={{ color: "#12d8ef", fontSize: 13 }}>{formatUsd(AXN_PRICE_USD, 6)}</strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={pillStyle}><span style={{ color: "#11d4ef" }}>Lvl</span><span style={{ float: "right", color: "rgba(255,255,255,.5)" }}>Coming soon</span></div>
          <div style={{ ...pillStyle, textAlign: "right" }}><span style={{ color: "#11d4ef" }}>Yield:</span> <span style={{ color: "rgba(255,255,255,.5)" }}>Coming soon</span></div>
        </div>

        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ color: "rgba(255,255,255,.62)", fontSize: 13, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>Total Assets <span style={{ color: "rgba(255,255,255,.36)", letterSpacing: 0 }}>({formatUsd(totalAssets / AXN_PER_USD, 2)} USD value)</span></div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
            <img src="/assets/axionet-mining.webp" alt="AXN" style={{ width: 31, height: 31, objectFit: "contain" }} />
            <strong style={{ color: "#fff", fontSize: "clamp(26px, 9vw, 38px)", lineHeight: 1, letterSpacing: "-.04em" }}>{formatAxn(totalAssets)} <span style={{ color: "#13d7ee", fontSize: 20, letterSpacing: 0 }}>AXN</span></strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 15 }}>
          <div style={pillStyle}>Holding <span style={{ float: "right", color: "#12d8ef" }}>Coming soon</span></div>
          <div style={{ ...pillStyle, textAlign: "right" }}>Pool <span style={{ color: "#12d8ef" }}>Coming soon</span></div>
        </div>

        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ color: "#10d9f2", fontSize: "clamp(37px, 13vw, 58px)", fontWeight: 900, lineHeight: 1, letterSpacing: ".02em", textShadow: "0 0 22px rgba(0,210,255,.35)" }}>+{formatAxn(amount)}</div>
          <div style={{ color: "rgba(255,255,255,.58)", fontSize: 13, marginTop: 7, letterSpacing: ".08em" }}>= {formatUsd(miningUsd, 4)} USD</div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", margin: "8px auto 14px", minHeight: 180 }}>
          <div style={{ width: 178, height: 178, borderRadius: "50%", display: "grid", placeItems: "center", background: "radial-gradient(circle, rgba(0,213,255,.25), rgba(0,17,29,.12) 58%, transparent 70%)", boxShadow: "0 0 46px rgba(0,195,255,.28)" }}>
            <img src="/assets/axionet-mining.webp" alt="AXN mining token" style={{ width: 142, height: 142, objectFit: "contain", filter: "drop-shadow(0 0 18px rgba(0,210,255,.55))" }} />
          </div>
        </div>

        <button type="button" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending || isLoading} style={{ width: "100%", height: 56, border: 0, borderRadius: 28, background: "linear-gradient(135deg, #08c8e5, #14e0ed)", color: "#03121d", fontSize: 15, fontWeight: 900, letterSpacing: ".04em", boxShadow: "0 12px 28px rgba(0,203,235,.24)", opacity: claimMutation.isPending || isLoading ? .65 : 1 }}>
          {claimMutation.isPending ? <Loader2 size={18} className="animate-spin" style={{ margin: "0 auto" }} /> : <><HandCoins size={18} style={{ verticalAlign: "-4px", marginRight: 7 }} /> CLAIM +{formatAxn(amount)} AXN ({formatUsd(miningUsd, 4)})</>}
        </button>

        <div style={{ marginTop: 12, padding: "13px 15px", borderRadius: 15, border: "1px solid rgba(0,190,255,.28)", background: "rgba(9,35,55,.72)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div><div style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>Package Lvl 1 <span style={{ color: "#12d8ef" }}>Coming soon</span></div><div style={{ color: "rgba(255,255,255,.46)", fontSize: 11, marginTop: 4 }}>{isActive ? `${ratePerHour.toFixed(4)} AXN/hour mining continuously` : "Starting mining…"}</div></div>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: isActive ? "#12d8ef" : "#64748b", boxShadow: isActive ? "0 0 12px #12d8ef" : "none", flexShrink: 0 }} />
        </div>
      </div>
    </section>
  );
}
