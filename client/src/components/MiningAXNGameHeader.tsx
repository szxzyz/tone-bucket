import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import DepositPopup from "@/components/DepositPopup";
import { TonIcon } from "@/components/TonIcon";

type Props = { onMenuOpen?: () => void };

/** Mining AXN-style header used only on the Games route. */
export default function MiningAXNGameHeader({ onMenuOpen }: Props) {
  const [overlayTop, setOverlayTop] = useState(0);
  const [depositOpen, setDepositOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isFetching } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous: any) => previous,
  });

  const firstName: string = user?.firstName || (isLoading || isFetching ? "Loading…" : "Miner");
  const profileImageUrl: string | null = user?.profileImageUrl ||
    (typeof window !== "undefined" ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url : null) || null;
  const telegramId: string | null =
    (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString()) ||
    user?.telegramId || user?.telegram_id || null;
  const tonBalance = Number.parseFloat(String(user?.tonBalance ?? user?.ton_balance ?? "0"));
  const initials = firstName.slice(0, 2).toUpperCase();

  useEffect(() => setAvatarFailed(false), [profileImageUrl]);

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
        <div
          style={{
            display: "flex", alignItems: "center", gap: 9, flex: "1 1 auto", minWidth: 0,
            maxWidth: "calc(100% - 126px)", height: 44, boxSizing: "border-box", padding: "2px 13px 2px 2px",
            background: "rgba(15,18,11,0.94)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999,
            boxShadow: "0 9px 24px rgba(0,0,0,0.22)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <button
            type="button"
            onClick={onMenuOpen}
            onDoubleClick={() => setLocation("/admin")}
            aria-label="Open menu"
            style={{
              width: 40, height: 40, borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center",
              justifyContent: "center", flexShrink: 0, background: "rgba(255,255,255,0.04)", border: "none", padding: 0,
            }}
            className="active:scale-90 transition-transform"
          >
            {profileImageUrl && !avatarFailed ? (
              <img src={profileImageUrl} alt="Open menu" onError={() => setAvatarFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>{initials}</span>
            )}
          </button>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 15, fontWeight: 700, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {firstName}
            </span>
            {telegramId && (
              <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 500, marginTop: 1, fontFamily: "Roboto Mono", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
                ID: {telegramId}
              </span>
            )}
          </div>
        </div>

        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", marginLeft: 2 }}>
          <div
            title="TON balance"
            style={{
              minWidth: 132, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center",
              gap: 7, padding: "7px 8px 7px 12px", background: "rgba(15,18,11,0.94)", border: "1px solid rgba(255,255,255,0.16)",
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
