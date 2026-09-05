import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { Plus, Clock } from "lucide-react";
import DepositPopup from "@/components/DepositPopup";
import { TonIcon } from "@/components/TonIcon";
import { useLocation } from "wouter";

interface HeaderProps {
  onMenuOpen?: () => void;
  onInviteOpen?: () => void;
  onWithdrawOpen?: () => void;
  onSettingsOpen?: () => void;
  onTransactionsOpen?: () => void;
  onPromoOpen?: () => void;
  onShareOpen?: () => void;
}

const Header = forwardRef<HTMLDivElement, HeaderProps>(
  ({ onMenuOpen }, ref) => {
    const [overlayTop, setOverlayTop] = useState(0);
    const [depositOpen, setDepositOpen] = useState(false);
    const innerRef = useRef<HTMLDivElement>(null);
    const [, setLocation] = useLocation();

    useImperativeHandle(ref, () => innerRef.current!);

  // Read the shared auth snapshot without starting a second mount-time
  // request. useAuth owns refresh/authentication for this query.
  const { data: user, isLoading, isFetching } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 30000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData: any) => previousData,
  });

  const hasConfirmedAxnBalance = user?.balance !== undefined && user?.balance !== null;
  const rawAxnBalance = hasConfirmedAxnBalance ? parseFloat(String(user.balance)) : null;
  const axnBalance = rawAxnBalance === null
    ? null
    : rawAxnBalance < 1 
      ? Math.round(rawAxnBalance * 10_000_000) 
      : Math.round(rawAxnBalance);

    const tonBalance = user?.tonBalance === undefined || user?.tonBalance === null
      ? null
      : parseFloat(String(user.tonBalance));

    useEffect(() => {
      const tg = (window as any).Telegram?.WebApp;
      if (!tg) return;

      const measure = () => {
        const st: number = tg.safeAreaInset?.top ?? 0;
        setOverlayTop(st);
        document.documentElement.style.setProperty('--tg-overlay-top', `${st}px`);
      };

      measure();
      tg.onEvent?.('safeAreaChanged', measure);
      tg.onEvent?.('viewportChanged', measure);

      const interval = setInterval(measure, 150);
      const stop = setTimeout(() => clearInterval(interval), 3000);
      return () => { clearInterval(interval); clearTimeout(stop); };
    }, []);

    useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      const update = () => {
        const h = el.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, [overlayTop]);

    return (
      <div
        ref={innerRef}
        className="fixed top-0 left-0 right-0 z-40"
        style={{
          background: "#000000",
          paddingTop: `${overlayTop + 6}px`,
        }}
      >
        <ResetCountdownBanner />
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px 10px",
          gap: 10,
        }}>

          {/* Left — Gold balance and TON top-up balance */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 100, height: 36, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 11 }}>
              <img src="/assets/gold-icon.png" alt="Gold" style={{ width: 24, height: 24, objectFit: 'contain', display: 'block', flexShrink: 0 }} />
              <span style={{ color: '#fff', fontSize: 15, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {axnBalance === null || !Number.isFinite(axnBalance) ? '—' : axnBalance.toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => setDepositOpen(true)}
              aria-label="Top up TON balance"
              style={{ minWidth: 116, height: 36, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '6px 9px', background: 'rgba(0,152,234,0.13)', border: '1px solid rgba(0,152,234,0.28)', borderRadius: 11, cursor: 'pointer' }}
              className="active:scale-95 transition-transform"
            >
              <TonIcon size={22} />
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {tonBalance === null || !Number.isFinite(tonBalance) ? '—' : tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              <span style={{ width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#0098EA', color: '#fff' }}>
                <Plus size={12} strokeWidth={3} />
              </span>
            </button>
          </div>

          {/* Right — universal Add Task button */}
          <button
            onClick={() => setLocation('/tasks/create')}
            style={{ height: 36, boxSizing: 'border-box', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 12px', border: 'none', borderRadius: 11, background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}
            className="active:scale-95 transition-transform"
            aria-label="Add Task"
          >
            <Plus size={16} strokeWidth={3} />
            Add Task
          </button>

        </div>
        <DepositPopup open={depositOpen} onClose={() => setDepositOpen(false)} />
      </div>
    );
  }
);

const ResetCountdownBanner = () => {
  const [resetCountdown, setResetCountdown] = useState("");
  const [nextResetLabel, setNextResetLabel] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const y = now.getUTCFullYear();
      const mo = now.getUTCMonth();
      const d = now.getUTCDate();

      const reset0630 = new Date(Date.UTC(y, mo, d, 6, 30, 0, 0));
      const reset1830 = new Date(Date.UTC(y, mo, d, 18, 30, 0, 0));

      let next: Date;
      let label: string;

      if (now < reset0630) {
        next = reset0630;
        label = "6:30 AM UTC";
      } else if (now < reset1830) {
        next = reset1830;
        label = "6:30 PM UTC";
      } else {
        next = new Date(Date.UTC(y, mo, d + 1, 6, 30, 0, 0));
        label = "6:30 AM UTC";
      }

      const total = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      setNextResetLabel(label);
      setResetCountdown(
        `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        background: "linear-gradient(90deg, #0d0d1a 0%, #1a0d3d 35%, #3d1580 65%, #6b21a8 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "5px 16px",
        borderBottom: "1px solid rgba(107,33,168,0.35)",
      }}
    >
      <Clock size={11} color="rgba(216,180,254,0.75)" strokeWidth={2.5} />
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "rgba(216,180,254,0.6)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Reset
      </span>
      <div style={{ width: 1, height: 10, background: "rgba(216,180,254,0.2)", borderRadius: 1 }} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "rgba(216,180,254,0.85)",
          letterSpacing: "0.04em",
          fontFamily: "Roboto Mono",
        }}
      >
        {nextResetLabel || "––:–– UTC"}
      </span>
      <div style={{ width: 1, height: 10, background: "rgba(216,180,254,0.2)", borderRadius: 1 }} />
      <span
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: "#e9d5ff",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.03em",
          fontFamily: "Roboto Mono",
        }}
      >
        {resetCountdown || "––h ––m ––s"}
      </span>
    </div>
  );
};

Header.displayName = "Header";
export default Header;
