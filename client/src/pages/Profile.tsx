import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import SwapSheet from "@/components/SwapSheet";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";
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

export default function Profile() {
  const { user, isFetching, dataUpdatedAt } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [swapSheetOpen, setSwapSheetOpen] = useState(false);

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

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
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
    },
    onError: (error: Error) => {
      showNotification(error.message, "error");
    },
  });

  const handleConvertClick = () => {
    setSwapSheetOpen(true);
  };

  const handleSwapConfirm = (convertTo: "USD" | "TON", amount: number) => {
    convertMutation.mutate(
      { amount, convertTo },
      { onSuccess: () => setSwapSheetOpen(false) }
    );
  };

  // ── Balance calculations ──────────────────────────────────────────────
  const typedUser = user as User;
  const rawBalance = parseFloat(typedUser?.balance || "0");
  const balanceGold = Math.floor(rawBalance);
  // Gold to USDT is fixed: 100,000 Gold = 1 USDT
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

  // ── User info ─────────────────────────────────────────────────────────────
  const photoUrl =
    typeof window !== 'undefined' &&
    (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const displayName = typedUser?.firstName || 'Guest';
  const userUID = typedUser?.telegramId || typedUser?.referralCode || "00000";

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 bg-black text-white" style={{ paddingTop: 16 }}>

        {/* ── User Info ── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)', marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid rgba(255,255,255,0.12)',
          }}>
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 30, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4, letterSpacing: '-0.3px' }}>
            {displayName}
          </h2>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.06em' }}>
            UID: {userUID}
          </span>
        </div>

        {/* ── Balance Section — exact same styling as original Home.tsx ── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
            {t('balance')}
          </p>

          {/* Main Gold balance */}
          <div style={{ marginBottom: 4 }}>
            {isFirstLoad ? (
              <div style={{ padding: '4px 0' }}>
                <div style={{
                  width: 140,
                  height: 40,
                  borderRadius: 8,
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
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setLocation('/withdraw')}
              className="btn-primary active:scale-95 transition-transform"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em' }}
            >
              {t('withdraw_upper')}
            </button>
            <button
              onClick={handleConvertClick}
              className="active:scale-95 transition-transform"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', border: 'none' }}
            >
              {t('swap')}
            </button>
          </div>
        </div>

      </main>

      <SwapSheet
        open={swapSheetOpen}
        minimumGold={appSettings?.minimumConvertGold ?? appSettings?.minimumConvertSWAG ?? 100}
        onClose={() => setSwapSheetOpen(false)}
        balanceGold={balanceGold}
        onSwap={handleSwapConfirm}
        isPending={convertMutation.isPending}
      />
    </Layout>
  );
}
