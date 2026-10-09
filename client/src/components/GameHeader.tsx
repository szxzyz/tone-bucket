import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Plus } from "lucide-react";
import { TonIcon } from "@/components/TonIcon";
import DepositPopup from "@/components/DepositPopup";
import { useLocation } from "wouter";

interface GameHeaderProps { onAddTask?: () => void; }
const Header = forwardRef<HTMLDivElement, GameHeaderProps>(({ onAddTask }, ref) => {
  const [overlayTop, setOverlayTop] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [location, setLocation] = useLocation();
  useImperativeHandle(ref, () => innerRef.current!);

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 0,
  });
  const rawGoldBalance = parseFloat(user?.balance || "0");
  const goldBalance = rawGoldBalance < 1 ? Math.round(rawGoldBalance * 10_000_000) : Math.round(rawGoldBalance);
  const profileImage = user?.profileImageUrl || user?.profile_image_url || "/assets/axionet-mining.webp";
  const tonBalance = user?.tonBalance === undefined || user?.tonBalance === null ? null : parseFloat(String(user.tonBalance));

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    const measure = () => {
      const safeTop = tg.safeAreaInset?.top ?? 0;
      setOverlayTop(safeTop);
      document.documentElement.style.setProperty("--tg-overlay-top", `${safeTop}px`);
    };
    measure();
    tg.onEvent?.("safeAreaChanged", measure);
    tg.onEvent?.("viewportChanged", measure);
    const interval = setInterval(measure, 150);
    const stop = setTimeout(() => clearInterval(interval), 3000);
    return () => { clearInterval(interval); clearTimeout(stop); };
  }, []);

  useEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    const update = () => document.documentElement.style.setProperty(
      "--header-height", `${Math.ceil(element.getBoundingClientRect().height)}px`
    );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [overlayTop]);

  return (
      <div ref={innerRef} className="fixed top-0 left-0 right-0 z-40" style={{ background: "#0f0f0f", paddingTop: `${overlayTop + 6}px` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "8px 12px 10px", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,.08)" }}>
            <img src={profileImage} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", flex: "0 1 auto", minWidth: 82, maxWidth: "calc(100% - 88px)", height: 38, boxSizing: "border-box", background: "rgba(255,255,255,0.04)", borderRadius: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
              <img src="/assets/axionet-mining.webp" alt="AXN" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <span style={{ color: "#fff", fontSize: 16, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goldBalance.toLocaleString()}</span>
          </div>
          <button
            type="button"
            onClick={() => setDepositOpen(true)}
            aria-label="Top up TON balance"
            className="active:scale-95 transition-transform"
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 8px", minWidth: 82, height: 38, boxSizing: "border-box", background: "rgba(255,255,255,0.04)", border: "none", borderRadius: 10, cursor: "pointer", flexShrink: 0 }}
          >
            <TonIcon size={18} />
            <span style={{ color: "#fff", fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{tonBalance === null || !Number.isFinite(tonBalance) ? "—" : tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            <span style={{ width: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.16)", color: "#fff" }}><Plus size={10} strokeWidth={3} /></span>
          </button>
        </div>
          {<button type="button" onClick={() => onAddTask ? onAddTask() : setLocation("/mission?open=create")} aria-label="Add Task" className="active:scale-95 transition-transform" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 10px", minWidth: 86, height: 38, boxSizing: "border-box", background: "rgba(255,255,255,0.04)", border: "none", borderRadius: 10, cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 12, fontWeight: 900 }}><Plus size={15} strokeWidth={3} />Add Task</button>}
      </div>
      {location === "/mission" && <ResetCountdownBanner />}
      {(location === "/" || location === "/mining") && <AxnTokenPriceBanner />}
      <DepositPopup open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
});

function AxnTokenPriceBanner() {
  return (
    <div style={{
      background: "linear-gradient(90deg, #0d0d1a 0%, #1a0d3d 35%, #3d1580 65%, #6b21a8 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      padding: "5px 16px", color: "#e9d5ff",
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(216,180,254,.7)" }}>Live</span>
      <div style={{ width: 1, height: 11, background: "rgba(216,180,254,.25)" }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em" }}>AXN token</span>
      <div style={{ width: 1, height: 11, background: "rgba(216,180,254,.25)" }} />
      <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "Roboto Mono", color: "#e9d5ff" }}>$0.000010</span>
    </div>
  );
}

function ResetCountdownBanner() {
  const [resetCountdown, setResetCountdown] = useState("");
  const [nextResetLabel, setNextResetLabel] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const day = now.getUTCDate();
      const resetMorning = new Date(Date.UTC(year, month, day, 6, 30, 0, 0));
      const resetEvening = new Date(Date.UTC(year, month, day, 18, 30, 0, 0));

      let nextReset: Date;
      let label: string;
      if (now < resetMorning) {
        nextReset = resetMorning;
        label = "6:30 AM UTC";
      } else if (now < resetEvening) {
        nextReset = resetEvening;
        label = "6:30 PM UTC";
      } else {
        nextReset = new Date(Date.UTC(year, month, day + 1, 6, 30, 0, 0));
        label = "6:30 AM UTC";
      }

      const totalSeconds = Math.max(0, Math.floor((nextReset.getTime() - now.getTime()) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setNextResetLabel(label);
      setResetCountdown(`${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`);
    }

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      aria-label={`Ad limit resets at ${nextResetLabel}, in ${resetCountdown}`}
      style={{
        background: "linear-gradient(90deg, #0d0d1a 0%, #1a0d3d 35%, #3d1580 65%, #6b21a8 100%)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: "5px 16px",
      }}
    >
      <Clock size={11} color="rgba(216,180,254,0.75)" strokeWidth={2.5} aria-hidden="true" />
      <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(216,180,254,0.6)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Reset</span>
      <div style={{ width: 1, height: 10, background: "rgba(216,180,254,0.2)", borderRadius: 1 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(216,180,254,0.85)", letterSpacing: "0.04em", fontFamily: "Roboto Mono, monospace" }}>{nextResetLabel || "––:–– UTC"}</span>
      <div style={{ width: 1, height: 10, background: "rgba(216,180,254,0.2)", borderRadius: 1 }} />
      <span style={{ fontSize: 12, fontWeight: 800, color: "#e9d5ff", fontVariantNumeric: "tabular-nums", letterSpacing: "0.03em", fontFamily: "Roboto Mono, monospace" }}>{resetCountdown || "––h ––m ––s"}</span>
    </div>
  );
}

Header.displayName = "Header";
export default Header;
