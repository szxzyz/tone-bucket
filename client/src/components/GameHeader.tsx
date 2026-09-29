import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu, Plus } from "lucide-react";
import { TonIcon } from "@/components/TonIcon";
import DepositPopup from "@/components/DepositPopup";

interface HeaderProps { onMenuOpen?: () => void; }

const Header = forwardRef<HTMLDivElement, HeaderProps>(({ onMenuOpen }, ref) => {
  const [overlayTop, setOverlayTop] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  useImperativeHandle(ref, () => innerRef.current!);

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 0,
  });
  const rawGoldBalance = parseFloat(user?.balance || "0");
  const goldBalance = rawGoldBalance < 1 ? Math.round(rawGoldBalance * 10_000_000) : Math.round(rawGoldBalance);
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
        <button
          onClick={onMenuOpen}
          aria-label="Open menu"
          className="active:scale-90 transition-transform"
          style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}
        >
          <Menu size={19} color="#fff" strokeWidth={2.2} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", flex: "0 1 auto", minWidth: 82, maxWidth: "calc(100% - 88px)", height: 38, boxSizing: "border-box", background: "rgba(255,255,255,0.04)", borderRadius: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
              <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
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

      </div>
      <DepositPopup open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
});

Header.displayName = "Header";
export default Header;
