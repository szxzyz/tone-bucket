import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu, Plus } from "lucide-react";
import DepositPopup from "@/components/DepositPopup";
import { TonIcon } from "@/components/TonIcon";

type Props = { onMenuOpen?: () => void };

/** Mining AXN-style header used only on the Games route. */
export default function MiningAXNGameHeader({ onMenuOpen }: Props) {
  const [overlayTop, setOverlayTop] = useState(0);
  const [depositOpen, setDepositOpen] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous: any) => previous,
  });

  const tonBalance = Number.parseFloat(String(user?.tonBalance ?? user?.ton_balance ?? "0"));

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    const measure = () => {
      const safeTop: number = tg.safeAreaInset?.top ?? 0;
      setOverlayTop(safeTop);
      document.documentElement.style.setProperty("--tg-overlay-top", `${safeTop}px`);
    };
    measure();
    tg.onEvent?.("safeAreaChanged", measure);
    tg.onEvent?.("viewportChanged", measure);
    const interval = window.setInterval(measure, 150);
    const stop = window.setTimeout(() => window.clearInterval(interval), 3_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
      tg.offEvent?.("safeAreaChanged", measure);
      tg.offEvent?.("viewportChanged", measure);
    };
  }, []);

  useEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    const update = () => {
      const height = element.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--header-height", `${Math.ceil(height + overlayTop + 12)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [overlayTop]);

  return (
    <div
      ref={innerRef}
      className="fixed z-40"
      style={{
        top: `${overlayTop + 12}px`,
        left: "max(12px, calc(env(safe-area-inset-left, 0px) + 12px))",
        right: "max(12px, calc(env(safe-area-inset-right, 0px) + 12px))",
        background: "transparent",
        overflow: "visible",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: 10 }}>
        <button
          type="button"
          onClick={onMenuOpen}
          aria-label="Open menu"
          className="active:scale-90 transition-transform"
          style={{
            width: 44, height: 44, display: "grid", placeItems: "center", flexShrink: 0,
            border: "none", borderRadius: 14, padding: 0, color: "#fff",
            background: "rgba(15,18,11,0.94)", boxShadow: "0 9px 24px rgba(0,0,0,0.22)",
          }}
        >
          <Menu size={22} strokeWidth={2.3} />
        </button>

        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", marginLeft: 2 }}>
          <div
            title="TON balance"
            style={{
              minWidth: 132, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center",
              gap: 7, padding: "7px 8px 7px 12px", background: "rgba(15,18,11,0.94)", border: "none",
              borderRadius: 999, boxShadow: "0 9px 24px rgba(0,0,0,0.22)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            }}
          >
            <span style={{ color: "#f2f2f4", fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {Number.isFinite(tonBalance) ? tonBalance.toFixed(4) : "0.0000"}
            </span>
            <TonIcon size={25} />
            <button
              type="button"
              title="Deposit TON"
              aria-label="Deposit TON"
              onClick={() => setDepositOpen(true)}
              style={{ width: 26, height: 26, display: "grid", placeItems: "center", flexShrink: 0, border: "1px solid rgba(255,79,93,0.6)", borderRadius: "50%", background: "#4b0d12", color: "#fff", cursor: "pointer", padding: 0 }}
              className="active:scale-90 transition-transform"
            >
              <Plus size={17} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
      <DepositPopup open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
}
