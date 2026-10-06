import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownToLine, CheckCircle2, ClipboardList, Coins, Users } from "lucide-react";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { useAdSession } from "@/hooks/useAdSession";
import { cancelRegisteredAdSession, confirmProviderCompletion, postWithAdVerification } from "@/lib/adRewardClaim";
import { showAdgramAd } from "@/lib/showAd";
import { TonIcon } from "@/components/TonIcon";

const ACTION_BACKGROUND = "linear-gradient(135deg, #1e40af, #3b82f6)";
const MYSTERY_DAILY_LIMIT = 1;

function formatNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0";
}

function HomeStatistics() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/public/statistics"],
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const cards = [
    ["Total users", data?.totalUsers, Users],
    ["Active today", data?.activeToday, Activity],
    ["Gold earned", data?.goldEarned, Coins],
    ["Total withdrawal", data ? `${formatNumber(data.totalWithdrawal)} TON` : "—", ArrowDownToLine],
    ["Tasks created", data?.taskCreated, ClipboardList],
    ["Tasks completed", data?.taskCompleted, CheckCircle2],
  ] as const;

  return (
    <section aria-label="App statistics">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>App Statistics</span>
        {isLoading && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Updating…</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>
        {cards.map(([label, value, Icon]) => (
          <div key={label} style={{ background: "#252525", borderRadius: 12, padding: "10px 11px", minWidth: 0, border: "1px solid rgba(255,255,255,0.04)" }}>
            <Icon size={16} strokeWidth={2.1} color="rgba(255,255,255,0.58)" style={{ marginBottom: 6 }} />
            <div style={{ color: "#fff", fontSize: "clamp(16px, 4.5vw, 21px)", fontWeight: 900, lineHeight: 1.05, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {typeof value === "string" ? value : data ? formatNumber(value) : "—"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
      <button type="button" onClick={onClick} className="active:scale-90 transition-transform" style={{ width: 52, height: 52, borderRadius: "50%", background: ACTION_BACKGROUND, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(37,99,235,0.4)", color: "#fff" }}>
        {children}
      </button>
      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.48)" }}>{label}</span>
    </div>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinShown, setCheckinShown] = useState(false);
  const [mysteryLoading, setMysteryLoading] = useState(false);
  const [mysteryClaimsToday, setMysteryClaimsToday] = useState(0);
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();

  const { data: user, isLoading: userLoading } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false });
  const { data: appConfig } = useQuery<any>({ queryKey: ["/api/config/app"], staleTime: 300_000, retry: false });
  const { data: checkinStatus } = useQuery<any>({
    queryKey: ["/api/daily-checkin/status"],
    queryFn: async () => {
      const response = await fetch("/api/daily-checkin/status", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (!checkinStatus || checkinShown) return;
    setCheckinShown(true);
    if (!checkinStatus.alreadyClaimedToday) setCheckinOpen(true);
  }, [checkinStatus, checkinShown]);

  useEffect(() => {
    if (!user?.mysteryBoxDate) {
      setMysteryClaimsToday(0);
      return;
    }
    const isToday = new Date(user.mysteryBoxDate).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    setMysteryClaimsToday(isToday ? Number(user.mysteryBoxCount ?? 0) : 0);
  }, [user]);

  const rawBalance = Number(user?.balance ?? 0);
  const balance = rawBalance < 1 ? Math.round(rawBalance * 10_000_000) : Math.round(rawBalance);
  const usdBalance = Number(user?.usdBalance ?? 0);
  const tonBalance = Number(user?.tonBalance ?? 0);
  const balanceLabel = balance.toLocaleString();
  const mysteryOpened = mysteryClaimsToday >= MYSTERY_DAILY_LIMIT;

  const openMysteryBox = async () => {
    if (mysteryOpened || mysteryLoading) return;
    setMysteryLoading(true);
    const sessionId = startSession();
    try {
      const registration = await apiRequest("POST", "/api/ads/register-session", { sessionId, adType: "adsgram", context: "mystery_box" });
      if (!registration.ok) throw new Error("Ad verification is not available right now");
      await showAdgramAd(appConfig?.adsgramMysteryBoxBlockId || import.meta.env.VITE_ADSGRAM_MYSTERY_BLOCK_ID || "");
      await confirmProviderCompletion(sessionId, "adsgram");
      await waitForForeground();
      const session = endSession();
      const data = await postWithAdVerification<any>("/api/mystery-box", {
        sessionId: session.sessionId,
        backgroundEntered: session.backgroundEntered,
        backgroundDuration: session.backgroundDuration,
      });
      setMysteryClaimsToday(Number(data.claimsToday ?? 1));
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      showNotification("Mystery Gift reward added to your AXN balance.", "success");
    } catch (error: any) {
      await cancelRegisteredAdSession(sessionId);
      cancelSession();
      showNotification(error?.message || "Ad was not completed. Try again.", "error");
    } finally {
      setMysteryLoading(false);
    }
  };

  if (userLoading) {
    return <div className="min-h-screen bg-[#090909] flex items-center justify-center text-white/50 text-sm">Loading…</div>;
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-3 text-white pb-[100px]" style={{ background: "#090909", minHeight: "100%" }}>
        <section aria-label="Wallet balance" style={{ padding: "18px 9px 14px", textAlign: "center", overflow: "hidden" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>Wallet Balance</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: balanceLabel.length > 14 ? 26 : balanceLabel.length > 10 ? 34 : 42, fontWeight: 700, color: "#fff", fontFamily: "Roboto Mono, monospace", letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums", lineHeight: 1, wordBreak: "break-all" }}>{balanceLabel}</span>
            <img src="/assets/gems-icon.svg" alt="AXN" style={{ width: 18, height: 18 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>≈ {tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} TON</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>≈ ${usdBalance.toFixed(4)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "clamp(14px, 5vw, 24px)" }}>
            <ActionButton label="Withdraw" onClick={() => setLocation("/account")}><ArrowDownToLine size={24} strokeWidth={2.5} /></ActionButton>
            <ActionButton label="Claim" onClick={() => setCheckinOpen(true)}><span style={{ fontSize: 23, lineHeight: 1 }}>◆</span></ActionButton>
            <ActionButton label="Mission" onClick={() => setLocation("/mission")}><ClipboardList size={23} strokeWidth={2.3} /></ActionButton>
          </div>
        </section>

        <section aria-label="TON faucet" style={{ margin: "2px 0 16px", padding: 18, borderRadius: 20, background: "linear-gradient(145deg, #111c3a 0%, #10131d 68%, #17121f 100%)", border: "1px solid rgba(96,165,250,0.2)", boxShadow: "0 12px 30px rgba(15,23,42,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(96,165,250,0.14)" }}><TonIcon size={25} /></div>
            <div>
              <div style={{ color: "#fff", fontSize: 17, fontWeight: 900 }}>TON Faucet</div>
              <div style={{ color: "rgba(255,255,255,0.48)", fontSize: 11, marginTop: 2 }}>Claim your daily reward</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 12, lineHeight: 1.45 }}>
              {checkinStatus?.alreadyClaimedToday ? "Today's faucet reward is claimed." : "Complete one quick check-in to claim today's reward."}
            </div>
            <button type="button" onClick={() => setCheckinOpen(true)} disabled={Boolean(checkinStatus?.alreadyClaimedToday)} className="active:scale-95 transition-transform" style={{ flexShrink: 0, height: 42, padding: "0 16px", border: "none", borderRadius: 13, background: checkinStatus?.alreadyClaimedToday ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, #38bdf8, #2563eb)", color: checkinStatus?.alreadyClaimedToday ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 12, fontWeight: 900 }}>{checkinStatus?.alreadyClaimedToday ? "CLAIMED" : "CLAIM NOW"}</button>
          </div>
        </section>

        <section aria-label="Quick rewards" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", margin: "0 0 10px 4px" }}>Quick Rewards</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 16px", background: "#252525", borderRadius: 14 }}>
            <img src="/assets/mystery-box.png" alt="Mystery Gift" style={{ width: 28, height: 28, objectFit: "contain" }} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>Mystery Gift</div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 3 }}>One reward available daily</div></div>
            <button type="button" onClick={openMysteryBox} disabled={mysteryOpened || mysteryLoading} style={{ background: mysteryOpened || mysteryLoading ? "rgba(255,255,255,0.06)" : ACTION_BACKGROUND, color: mysteryOpened || mysteryLoading ? "rgba(255,255,255,0.3)" : "#fff", border: "none", width: 84, height: 36, borderRadius: 11, fontSize: 11, fontWeight: 800 }}>{mysteryLoading ? "..." : mysteryOpened ? "DONE" : "OPEN"}</button>
          </div>
        </section>

        <HomeStatistics />
      </main>

      <DailyCheckinSheet
        open={checkinOpen}
        onClose={() => setCheckinOpen(false)}
        streak={checkinStatus?.streak ?? 0}
        dayIndex={checkinStatus?.dayIndex ?? 0}
        alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? false}
        adsgramBlockId={appConfig?.adsgramCheckinBlockId || ""}
        onClaimed={() => {
          setCheckinOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/daily-checkin/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        }}
      />

    </Layout>
  );
}
