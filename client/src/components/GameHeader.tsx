import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { TonIcon } from "@/components/TonIcon";

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
    const [notifOpen, setNotifOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [overlayTop, setOverlayTop] = useState(0);
    const innerRef = useRef<HTMLDivElement>(null);
    const seenIds = useRef<Set<string>>(new Set());
    const [, setLocation] = useLocation();

    useImperativeHandle(ref, () => innerRef.current!);

    const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 0 });
    const { data: withdrawalsData } = useQuery<any>({
      queryKey: ['/api/withdrawals'],
      staleTime: 30000,
    });

    const tonBalance = user?.tonBalance === undefined || user?.tonBalance === null ? null : parseFloat(String(user.tonBalance));

    const firstName: string = user?.firstName || user?.username || "Miner";
    const profileImageUrl: string | null =
      user?.profileImageUrl ||
      (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url) ||
      null;
    const initials = firstName.slice(0, 2).toUpperCase();

    // Real Telegram UID — prefer from Telegram WebApp directly, fallback to DB field
    const tgUid: string | null =
      (typeof window !== "undefined" &&
        (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString()) ||
      user?.telegramId ||
      user?.telegram_id ||
      null;

    const withdrawals: any[] = withdrawalsData?.withdrawals ?? [];
    useEffect(() => {
      if (withdrawals.length === 0) return;
      const stored = JSON.parse(localStorage.getItem('grabpenny_seen_transactions') || '[]') as string[];
      seenIds.current = new Set(stored);
      setUnreadCount(withdrawals.filter(w => !seenIds.current.has(String(w.id))).length);
    }, [withdrawalsData]);

    const handleBellClick = () => {
      setNotifOpen(v => !v);
      const ids = withdrawals.map(w => String(w.id));
      localStorage.setItem('grabpenny_seen_transactions', JSON.stringify(ids));
      seenIds.current = new Set(ids);
      setUnreadCount(0);
    };

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
          background: "#0a0a0a",
          paddingTop: `${overlayTop + 6}px`,
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px 10px",
          gap: 10,
        }}>

          {/* Left — Profile photo + name + UID */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <button
              onClick={onMenuOpen}
              onDoubleClick={() => setLocation('/admin')}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                overflow: "hidden", display: "flex",
                alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,255,255,0.12)",
              }}
              className="active:scale-90 transition-transform"
            >
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt={firstName}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                    const parent = target.parentElement;
                    if (parent) {
                      const span = document.createElement("span");
                      span.style.cssText = "color:#fff;font-size:13px;font-weight:900;";
                      span.textContent = initials;
                      parent.appendChild(span);
                    }
                  }}
                />
              ) : (
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>{initials}</span>
              )}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <span style={{
                color: '#ffffff', fontSize: 14, fontWeight: 700, lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {firstName}
              </span>
              {tgUid && (
                <span style={{
                  color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 500,
                  marginTop: 1, fontFamily: 'monospace', letterSpacing: '0.02em',
                }}>
                  ID: {tgUid}
                </span>
              )}
            </div>
          </div>

          {/* Game page: TON balance only, matching the regular Header */}
          <button aria-label="TON balance" style={{ minWidth: 116, height: 36, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '6px 9px', background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 11 }}>
            <TonIcon size={22} />
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {tonBalance === null || !Number.isFinite(tonBalance) ? '—' : tonBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
            <span style={{ color:'rgba(255,255,255,.45)', fontSize:11, fontWeight:800 }}>TON</span>
            <span style={{ width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.16)', color: '#fff' }}><Plus size={12} strokeWidth={3} /></span>
          </button>

          {/* Right — Notification bell (clean, no box) */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={handleBellClick}
              className="active:scale-90 transition-transform"
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'none', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', cursor: 'pointer',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke={notifOpen ? '#60a5fa' : 'rgba(255,255,255,0.6)'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {unreadCount > 0 && (
                <div style={{
                  position: 'absolute', top: 1, right: 0,
                  minWidth: 17, height: 17, borderRadius: 9,
                  background: '#ef4444', border: '1.5px solid #0a0a0a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxSizing: 'border-box',
                }}><span style={{ color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>{unreadCount > 99 ? '99+' : unreadCount}</span></div>
              )}
            </button>

            {notifOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setNotifOpen(false)} />
                <div style={{
                  position: 'fixed',
                  top: 'calc(var(--header-height, 62px) + 8px)',
                  right: 12, width: 'min(290px, calc(100vw - 24px))', zIndex: 999,
                  background: '#0d0d0f',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 18,
                  boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
                  overflow: 'hidden',
                }}>
                  <div style={{ padding: '13px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>Withdrawal History</span>
                    <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {withdrawals.length === 0 ? (
                      <div style={{ padding: '28px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.28)', fontSize: 13 }}>
                        No withdrawals yet
                      </div>
                    ) : (
                      withdrawals.map((w: any) => {
                        const sc = statusColor(w.status);
                        const date = new Date(w.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                        return (
                          <div key={w.id} style={{
                            padding: '11px 16px',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}>
                            <div>
                              <div style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>
                                {parseFloat(w.amount).toLocaleString()} GOLD
                              </div>
                              <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10, marginTop: 2 }}>{date}</div>
                            </div>
                            <span style={{
                              fontSize: 9, fontWeight: 800, padding: '3px 9px', borderRadius: 50,
                              background: `${sc}18`, border: `1px solid ${sc}40`, color: sc,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>{w.status}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    );
  }
);

Header.displayName = "Header";
export default Header;
