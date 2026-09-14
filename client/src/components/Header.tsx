import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { Plus, Clock, Bell, X } from "lucide-react";
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

function statusColor(status: string) {
  if (status === 'approved' || status === 'completed' || status === 'paid') return '#4ade80';
  if (status === 'rejected') return '#f87171';
  return '#fbbf24';
}

const Header = forwardRef<HTMLDivElement, HeaderProps>(
  ({ onMenuOpen }, ref) => {
    const [overlayTop, setOverlayTop] = useState(0);
    const [depositOpen, setDepositOpen] = useState(false);
    const [notificationOpen, setNotificationOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [location] = useLocation();
    const innerRef = useRef<HTMLDivElement>(null);

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
  const { data: withdrawalsData } = useQuery<any>({ queryKey: ['/api/withdrawals'], staleTime: 30000 });
  const withdrawals = withdrawalsData?.withdrawals ?? [];
  useEffect(() => {
    if (withdrawals.length === 0) return;
    try {
      const seen = new Set<string>(JSON.parse(localStorage.getItem('grabpenny_seen_transactions') || '[]'));
      setUnreadCount(withdrawals.filter((item: any) => !seen.has(String(item.id))).length);
    } catch {
      setUnreadCount(withdrawals.length);
    }
  }, [withdrawalsData]);

  const hasConfirmedGoldBalance = user?.balance !== undefined && user?.balance !== null;
  const rawGoldBalance = hasConfirmedGoldBalance ? parseFloat(String(user.balance)) : null;
  const goldBalance = rawGoldBalance === null ? null : rawGoldBalance < 1
    ? Math.round(rawGoldBalance * 10_000_000)
    : Math.round(rawGoldBalance);

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
        className="fixed top-0 left-0 right-0 z-[1200]"
        style={{
          background: "#000000",
          paddingTop: `${overlayTop + 6}px`,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
          boxShadow: "0 4px 18px rgba(0,0,0,0.45)",
        }}
      >
        {location === '/mission' && <ResetCountdownBanner />}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px 10px",
          gap: 10,
        }}>

          {/* Gold balance and TON balance */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 100, height: 36, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 11 }}>
              <img src="/assets/gem-icon.png" alt="Gold" style={{ width: 24, height: 24, objectFit: 'contain', display: 'block', flexShrink: 0 }} />
              <span style={{ color: '#fff', fontSize: 15, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {goldBalance === null || !Number.isFinite(goldBalance) ? '—' : goldBalance.toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => setDepositOpen(true)}
              aria-label="Top up TON balance"
              style={{ minWidth: 116, height: 36, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '6px 9px', background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 11, cursor: 'pointer' }}
              className="active:scale-95 transition-transform"
            >
              <TonIcon size={22} />
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {tonBalance === null || !Number.isFinite(tonBalance) ? '—' : tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              <span style={{ width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.16)', color: '#fff' }}>
                <Plus size={12} strokeWidth={3} />
              </span>
            </button>
          </div>

          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => { setNotificationOpen(v => !v); const ids = withdrawals.map((item: any) => String(item.id)); localStorage.setItem('grabpenny_seen_transactions', JSON.stringify(ids)); setUnreadCount(0); }} aria-label="Notifications" style={{ width: 36, height: 36, borderRadius: '50%', background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: notificationOpen ? '#60a5fa' : 'rgba(255,255,255,0.65)', cursor: 'pointer', position: 'relative' }}>
              <Bell size={21} strokeWidth={2} />
              {unreadCount > 0 && <span style={{ position: 'absolute', top: 0, right: -1, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 9, background: '#ef4444', border: '1.5px solid #0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            {notificationOpen && <>
              <div onClick={() => setNotificationOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
              <div style={{ position: 'fixed', top: 'calc(var(--header-height, 62px) + 8px)', right: 12, width: 'min(290px, calc(100vw - 24px))', zIndex: 999, background: '#0d0d0f', border: '1px solid rgba(255,255,255,.08)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,.7)' }}>
                <div style={{ padding: '13px 16px 10px', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', justifyContent: 'space-between', color: '#fff', fontSize: 13, fontWeight: 800 }}>Transactions <button onClick={() => setNotificationOpen(false)} style={{ background: 'none', border: 0, color: 'rgba(255,255,255,.4)' }}><X size={14} /></button></div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {withdrawals.length === 0 ? <div style={{ padding: 26, textAlign: 'center', color: 'rgba(255,255,255,.3)', fontSize: 12 }}>No transactions yet</div> : withdrawals.slice(0, 6).map((item: any) => { const color = statusColor(String(item.status || '').toLowerCase()); const date = new Date(item.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); return <div key={item.id} style={{ padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><div><div style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{parseFloat(item.amount).toLocaleString()} GOLD</div><div style={{ color: 'rgba(255,255,255,.28)', fontSize: 10, marginTop: 2 }}>{date}</div></div><span style={{ fontSize: 9, fontWeight: 800, padding: '3px 9px', borderRadius: 50, background: `${color}18`, border: `1px solid ${color}40`, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>{item.status || 'pending'}</span></div>; })}
                </div>
              </div>
            </>}
          </div>

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
