import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { showNotification } from "@/components/AppNotification";
import SwapSheet from "@/components/SwapSheet";
import { useState } from "react";
import { useLanguage } from "@/hooks/useLanguage";

interface User {
  id?: string;
  telegramId?: string;
  balance?: string;
  usdBalance?: string;
  firstName?: string;
  referralCode?: string;
  [key: string]: any;
}

interface Earning {
  id: number;
  amount: string;
  source: string;
  description?: string;
  createdAt: string;
}

interface BalanceBottomSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function BalanceBottomSheet({ open, onClose }: BalanceBottomSheetProps) {
  const { user, isFetching, dataUpdatedAt } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [swapSheetOpen, setSwapSheetOpen] = useState(false);

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  const { data: earningsData } = useQuery<Earning[]>({
    queryKey: ['/api/earnings', 5],
    queryFn: async () => {
      const res = await fetch('/api/earnings?limit=5', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
    retry: false,
  });

  const convertMutation = useMutation({
    mutationFn: async ({ amount, convertTo }: { amount: number; convertTo: string }) => {
      const res = await fetch("/api/convert-to-usd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ axnAmount: amount, gemsAmount: amount, convertTo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to convert");
      return data;
    },
    onSuccess: (data) => {
      showNotification("Convert successful.", "success");
      queryClient.setQueryData(["/api/auth/user"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ...(data.newAxnBalance !== undefined && { balance: String(Math.round(data.newAxnBalance)) }),
          ...(data.newPowBalance !== undefined && { balance: String(Math.round(data.newPowBalance)) }),
          ...(data.newUsdBalance !== undefined && { usdBalance: data.newUsdBalance }),
          ...(data.newTonBalance !== undefined && { tonBalance: data.newTonBalance }),
          ...(data.newStarBalance !== undefined && { starBalance: data.newStarBalance }),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings", 5] });
    },
    onError: (error: Error) => {
      showNotification(error.message, "error");
    },
  });

  const handleSwapConfirm = (convertTo: "USD" | "TON", amount: number) => {
    convertMutation.mutate(
      { amount, convertTo },
      { onSuccess: () => setSwapSheetOpen(false) }
    );
  };

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const { data: tonPrice = 5.5 } = useQuery<number>({
    queryKey: ["/api/ton-price"],
    queryFn: async () => {
      const res = await fetch("/api/ton-price");
      if (!res.ok) return 5.5;
      const data = await res.json();
      return data.price || 5.5;
    },
    refetchInterval: 30000,
  });

  // Balance calculations
  const typedUser = user as User;
  const rawBalance = parseFloat(typedUser?.balance || "0");
  const balanceGold = Math.floor(rawBalance);
  // Gold to USDT is fixed: 100,000 Gold = 1 USD
  const balanceUSD = balanceGold / 100_000;
  // USDT to TON depends on market price
  const balanceTON = balanceUSD / tonPrice;

  const roundForDisplay = (n: number): number => {
    if (n >= 1_000_000) return Math.round(n / 10_000) * 10_000;
    if (n >= 10_000)    return Math.round(n / 1_000)  * 1_000;
    if (n >= 1_000)     return Math.round(n / 100)    * 100;
    if (n >= 100)       return Math.round(n / 10)     * 10;
    return Math.round(n);
  };

  const formatBalance = (n: number) => {
    const r = roundForDisplay(n);
    if (r >= 1_000_000) return (r / 1_000_000).toFixed(1) + 'M';
    if (r >= 1_000)     return (r / 1_000).toFixed(0) + 'k';
    return r.toLocaleString();
  };

  const isFirstLoad = isFetching && dataUpdatedAt === 0;

  const usdFormatted = balanceUSD.toLocaleString(undefined, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: balanceUSD < 0.01 ? 6 : 4 
  });

  const tonFormatted = balanceTON.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });

  const formatEarningDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatEarningAmount = (amount: string) => {
    const n = parseFloat(amount);
    if (!isFinite(n)) return amount;
    const axn = n < 1 ? Math.round(n * 10000000) : Math.round(n);
    return `+${axn.toLocaleString()}`;
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="balance-sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={onClose}
              style={{
                position: 'fixed', inset: 0, zIndex: 50,
                background: 'rgba(0,0,0,0.72)',
                backdropFilter: 'blur(2px)',
              }}
            />

            {/* Sheet Panel */}
            <motion.div
              key="balance-sheet-panel"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320, mass: 0.9 }}
              style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 51,
                background: '#111',
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                maxHeight: '90vh',
                overflowY: 'auto',
                paddingBottom: 'env(safe-area-inset-bottom, 20px)',
              }}
            >
              {/* Drag handle */}
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                style={{
                  position: 'absolute', top: 14, right: 16,
                  background: 'rgba(255,255,255,0.08)', border: 'none',
                  width: 30, height: 30, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.6)',
                }}
                className="active:scale-90 transition-transform"
              >
                <X size={16} />
              </button>

              {/* The App Core image */}
              <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 8, paddingBottom: 4 }}>
                <img
                  src="/the-app-core.jpg"
                  alt="The App Core"
                  style={{
                    width: '100%',
                    borderRadius: 16,
                    objectFit: 'cover',
                    maxHeight: 120,
                    display: 'block',
                  }}
                />
              </div>

              {/* Balance + Withdraw + Swap */}
              <div style={{ padding: '20px 20px 0' }}>
                <p style={{
                  fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.38)',
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2,
                }}>
                  {t('balance')}
                </p>

                {/* Main Gold balance */}
                <div style={{ marginBottom: 6, minHeight: 52 }}>
                  {isFirstLoad ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 52 }}>
                      <div style={{
                        width: 140, height: 40, borderRadius: 8,
                        background: 'rgba(255,255,255,0.08)',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{
                        fontSize: balanceGold >= 1000000 ? 36 : balanceGold >= 10000 ? 44 : 48,
                        fontWeight: 800,
                        color: '#fff',
                        fontFamily: "Roboto Mono",
                        letterSpacing: '-1.5px',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                      }}>
                        {formatBalance(balanceGold)}
                      </span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.45)', lineHeight: 1, letterSpacing: '0.04em' }}><img src="/assets/gold-icon.png" style={{ width: 18, height: 18, display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }} /></span>
                    </div>
                  )}
                </div>

                {/* USD and TON equivalent row */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px 12px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <img src="/usdt.png" alt="USDT" style={{ width: 16, height: 16, objectFit: 'contain', opacity: 0.6 }} />
                    <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
                      ${usdFormatted}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <img src="/ton-icon.png" alt="TON" style={{ width: 16, height: 16, objectFit: 'contain', opacity: 0.6 }} />
                    <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
                      {tonFormatted} TON
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
                  <button
                    onClick={() => setLocation('/withdraw')}
                    className="btn-primary active:scale-95 transition-transform"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700,
                      cursor: 'pointer', letterSpacing: '0.03em',
                    }}
                  >
                    {t('withdraw_upper')}
                  </button>
                  <button
                    onClick={() => setSwapSheetOpen(true)}
                    className="active:scale-95 transition-transform"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700,
                      cursor: 'pointer', letterSpacing: '0.03em',
                      background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', border: 'none',
                    }}
                  >
                    {t('swap')}
                  </button>
                </div>

                {/* Earning History */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16, paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>History</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>›</span>
                  </div>

                  {!earningsData || earningsData.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13, padding: '16px 0' }}>
                      No earning history yet
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {earningsData.slice(0, 5).map((earning) => (
                        <div
                          key={earning.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', borderRadius: 10,
                            background: 'rgba(255,255,255,0.04)',
                          }}
                        >
                          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
                            {formatEarningDate(earning.createdAt)}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{formatEarningAmount(earning.amount)} <img src="/assets/gold-icon.png" style={{ width: 12, height: 12 }} /></div>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* bottom padding for safe area */}
              <div style={{ height: 20 }} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SwapSheet
        open={swapSheetOpen}
        minimumGold={appSettings?.minimumConvertGold ?? appSettings?.minimumConvertSWAG ?? 100}
        onClose={() => setSwapSheetOpen(false)}
        balanceGold={balanceGold}
        onSwap={handleSwapConfirm}
        isPending={convertMutation.isPending}
      />

    </>
  );
}
