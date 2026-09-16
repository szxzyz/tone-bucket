import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import MenuPopup from "@/components/GameMenuPopup";
import Header from "@/components/GameHeader";
import BottomNav from "@/components/BottomNav";
import GameWithdrawPopup from "@/components/GameWithdrawPopup";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import PromoCodeInput from "@/components/PromoCodeInput";
import { useLocation } from "wouter";
import { showAdgramAd } from "@/lib/showAd";
import { useAdmin } from "@/hooks/useAdmin";
import { Info, Rocket } from "lucide-react";
import { getTONPrice, gemsToTon as axnToTon, tonToUsd, formatTon, formatUsd } from "@/lib/tonPriceService";
const GEMS_PER_TON = 1000000;

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

type MysteryPhase = 'idle' | 'opening' | 'revealed' | 'claiming' | 'done';

const FARM_RATE = 23.9574;
const FARM_DURATION = 3600;
const FARM_MAX = parseFloat((FARM_DURATION * FARM_RATE).toFixed(4));
const FARM_BOOSTS = [1, 2, 4, 8, 10, 15, 20, 25];

function fmtCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export default function Games() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [tonPrice, setTonPrice] = useState<number>(3.5);
  const [showStakingPopup, setShowStakingPopup] = useState(false);
  const [showWithdrawPopup, setShowWithdrawPopup] = useState(false);
  const [showPromoPopup, setShowPromoPopup] = useState(false);
  const [showSwapPopup, setShowSwapPopup] = useState(false);
  const [checkinSheetOpen, setCheckinSheetOpen] = useState(false);
  const [dailyChecked, setDailyChecked] = useState(() => localStorage.getItem('daily_check_date') === getTodayKey());
  const [dailyAdLoading, setDailyAdLoading] = useState(false);
  const [mysteryOpened, setMysteryOpened] = useState(() => localStorage.getItem('mystery_box_date') === getTodayKey());

  const [mysteryPhase, setMysteryPhase] = useState<MysteryPhase>('idle');
  const [isSharing, setIsSharing] = useState(false);
  const mysteryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Farming state
  const [farmCountdown, setFarmCountdown] = useState(FARM_DURATION);
  const [farmAccum, setFarmAccum] = useState(0);
  const [showFarmInfo, setShowFarmInfo] = useState(false);
  const [showAlertPopup, setShowAlertPopup] = useState(false);
  const farmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { isAdmin } = useAdmin();
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 0 });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ['/api/bot-info'], staleTime: 3600000 });
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], staleTime: 300000, retry: false });
  const { data: swapSettings } = useQuery<{ swapRate: number; swapMinCipher: number }>({ queryKey: ['/api/swap-config'], staleTime: 60000 });
  const { data: checkinStatus } = useQuery<any>({ queryKey: ['/api/daily-checkin/status'], retry: false });

  const runVerifiedAdsgramReward = async (context: 'daily_checkin' | 'mystery_box') => {
    const sessionId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let backgroundEntered = false;
    let backgroundStartedAt = 0;
    let backgroundDuration = 0;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        backgroundEntered = true;
        backgroundStartedAt = Date.now();
      } else if (backgroundStartedAt) {
        backgroundDuration += Date.now() - backgroundStartedAt;
        backgroundStartedAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    try {
      const register = await apiRequest('POST', '/api/ads/register-session', { sessionId, adType: 'adsgram', context });
      if (!register.ok) throw new Error('Could not start ad session');
      await showAdgramAd(appConfig?.adsgramRewardBlockId || '');
      if (document.visibilityState === 'hidden') {
        await new Promise<void>(resolve => {
          const onVisible = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVisible); resolve(); } };
          document.addEventListener('visibilitychange', onVisible);
        });
      }
      if (backgroundStartedAt) backgroundDuration += Date.now() - backgroundStartedAt;
      return { sessionId, backgroundEntered, backgroundDuration };
    } finally {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  const axnRaw = parseFloat(user?.walletBalance ?? user?.balance ?? '0');
  const axnBalance = Math.floor(axnRaw);

  // 100,000 Gold = 1 USDT (Fixed)
  const usdValue = axnRaw / 100_000;
  // USDT to TON based on live market price
  const tonValue = tonPrice > 0 ? usdValue / tonPrice : 0;

  const tonDisplay = formatTon(tonValue);
  const usdDisplay = formatUsd(usdValue);
  const axnDisplay = axnRaw === 0 ? '0' : axnRaw % 1 === 0
    ? axnRaw.toLocaleString()
    : parseFloat(axnRaw.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });

  const firstName: string = user?.firstName || user?.username || "User";
  const profileImageUrl: string | null =
    user?.profileImageUrl ||
    (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url) ||
    null;
  const initials = firstName.slice(0, 2).toUpperCase();

  const botUsername = botInfo?.username || 'bot';
  const referralLink = user?.referralCode ? `https://t.me/${botUsername}?start=${user.referralCode}` : '';

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const price = await getTONPrice();
      if (!cancelled) setTonPrice(price);
    };
    fetch();
    const interval = setInterval(fetch, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const todayKey = getTodayKey();
    if (user.dailyCheckinClaimed && user.dailyTasksDate) {
      const serverDate = new Date(user.dailyTasksDate).toISOString().slice(0, 10);
      if (serverDate === todayKey) {
        setDailyChecked(true);
        localStorage.setItem('daily_check_date', todayKey);
      } else {
        setDailyChecked(false);
        localStorage.removeItem('daily_check_date');
      }
    } else if (!user.dailyCheckinClaimed) {
      setDailyChecked(false);
      localStorage.removeItem('daily_check_date');
    }
    if (user.mysteryBoxDate) {
      const serverDate = new Date(user.mysteryBoxDate).toISOString().slice(0, 10);
      if (serverDate === todayKey) {
        setMysteryOpened(true);
        localStorage.setItem('mystery_box_date', todayKey);
      } else {
        setMysteryOpened(false);
        localStorage.removeItem('mystery_box_date');
      }
    } else {
      setMysteryOpened(false);
      localStorage.removeItem('mystery_box_date');
    }
  }, [user]);

  const dailyCheckMutation = useMutation({
    mutationFn: async (session: { sessionId: string; backgroundEntered: boolean; backgroundDuration: number }) => {
      const res = await apiRequest('POST', '/api/daily-checkin', session);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      return data;
    },
    onSuccess: (data) => {
      setDailyChecked(true);
      localStorage.setItem('daily_check_date', getTodayKey());
      showNotification(`Daily check-in done! +${data.reward ?? 5} Gold added`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Daily check-in failed. Try again.', 'error');
    },
  });

  const handleDailyCheck = async () => {
    if (dailyChecked || dailyAdLoading || dailyCheckMutation.isPending) return;
    setDailyAdLoading(true);
    let session;
    try { session = await runVerifiedAdsgramReward('daily_checkin'); } catch (error: any) { setDailyAdLoading(false); showNotification(error?.message || 'Ad could not be completed', 'error'); return; }
    setDailyAdLoading(false);
    dailyCheckMutation.mutate(session);
  };

  const handleMysteryOpen = async () => {
    if (mysteryOpened || mysteryPhase !== 'idle') return;
    setMysteryPhase('claiming');
    try {
      const session = await runVerifiedAdsgramReward('mystery_box');
      const res = await apiRequest('POST', '/api/mystery-box', session);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not claim gift');
      setMysteryOpened(true);
      localStorage.setItem('mystery_box_date', getTodayKey());
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification(`${data.reward ?? 0} Gold earned`, 'success');
      setMysteryPhase('done');
      mysteryTimerRef.current = setTimeout(() => setMysteryPhase('idle'), 800);
    } catch (err: any) {
      setMysteryPhase('idle');
      const message = String(err?.message || '');
      showNotification(message.toLowerCase().includes('not configured') ? 'Ad unavailable' : (message || 'Ad unavailable'), 'error');
    }
  };

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink)
      .then(() => showNotification('Invite link copied!', 'success'))
      .catch(() => showNotification('Invite link copied!', 'success'));
  };

  const shareLink = async () => {
    if (!referralLink || isSharing) return;
    setIsSharing(true);
    try {
      const tg = (window as any).Telegram?.WebApp;
      const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Gold Bux! I earn 150 Gold for every friend who completes 10 tasks. Start earning now!')}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank');
    } catch {}
    setIsSharing(false);
  };

  // Farming query & mutations
  const { data: farmData, refetch: refetchFarm } = useQuery<any>({
    queryKey: ['/api/farming/state'],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!farmData) return;
    setFarmCountdown(farmData.remainingSeconds ?? FARM_DURATION);
    setFarmAccum(farmData.minedAxn ?? 0);
  }, [farmData]);

  useEffect(() => {
    if (farmIntervalRef.current) clearInterval(farmIntervalRef.current);
    const isActive = farmData?.isActive;
    if (!isActive) return;
    const rate = farmData?.effectiveRate ?? FARM_RATE;
    const maxAxn = (FARM_DURATION / 3600) * rate;
    const goldPerSecond = rate / 3600;
    farmIntervalRef.current = setInterval(() => {
      setFarmCountdown(prev => Math.max(0, prev - 1));
      setFarmAccum(prev => parseFloat(Math.min(prev + goldPerSecond, maxAxn).toFixed(4)));
    }, 1000);
    return () => { if (farmIntervalRef.current) clearInterval(farmIntervalRef.current); };
  }, [farmData?.isActive, farmData?.startedAt, farmData?.effectiveRate]);

  const farmStartMutation = useMutation({
    mutationFn: async () => {
      await showAdgramAd(appConfig?.adsgramRewardBlockId || '');
      const res = await apiRequest('POST', '/api/farming/start', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to start');
      return data;
    },
    onSuccess: () => {
      showNotification('Mining started', 'success');
      refetchFarm();
    },
    onError: (err: any) => showNotification(err?.message || 'Failed to start farming', 'error'),
  });

  const farmClaimMutation = useMutation({
    mutationFn: async () => {
      await showAdgramAd(appConfig?.adsgramRewardBlockId || '');
      const res = await apiRequest('POST', '/api/farming/claim', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to claim');
      return data;
    },
    onSuccess: (data) => {
      showNotification(`${data.amount} Gold claimed`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      refetchFarm();
    },
    onError: (err: any) => showNotification(err?.message || 'Failed to claim', 'error'),
  });

  const farmBoostMutation = useMutation({
    mutationFn: async () => {
      await showAdgramAd(appConfig?.adsgramRewardBlockId || '');
      const res = await apiRequest('POST', '/api/farming/boost', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to boost mining');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/farming/state'] });
      showNotification(`Mining boosted to ${data.multiplier}x`, 'success');
    },
    onError: (err: any) => showNotification(err?.message || 'Could not boost mining', 'error'),
  });

  return (
    <div style={{ height: '100dvh', background: '#090909', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes boxPulse {
          0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(61,21,128,0.4); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(61,21,128,0); }
        }
        @keyframes rewardIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes axn-glow { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
        @keyframes axn-pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        @keyframes popup-glow { 0%,100%{opacity:0.5} 50%{opacity:1} }
      `}</style>

      <Header onMenuOpen={() => setMenuOpen(true)} />

      {/* Balance Section */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--header-height, 62px) + 14px)',
        paddingLeft: 'clamp(12px, 4vw, 24px)',
        paddingRight: 'clamp(12px, 4vw, 24px)',
        paddingBottom: 12,
        textAlign: 'center',
        overflow: 'hidden',
      }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            Wallet Balance
          </div>

          {/* Gold main balance */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 1, maxWidth: '100%', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: axnDisplay.length > 16 ? 22 : axnDisplay.length > 14 ? 26 : axnDisplay.length > 10 ? 34 : 42,
              fontWeight: 700, color: '#fff',
              fontFamily: "Roboto Mono",
              letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              wordBreak: 'break-all', overflowWrap: 'break-word', minWidth: 0,
              maxWidth: 'calc(100vw - 80px)',
            }}>
              {balanceHidden ? '••••' : axnDisplay}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.45)', alignSelf: 'flex-end', paddingBottom: 4 }}><img src="/assets/gem-icon.png" style={{ width: 18, height: 18, display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }} /></span>
            <button onClick={() => setBalanceHidden(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, alignSelf: 'center', flexShrink: 0 }}>
              {balanceHidden ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>

          {/* TON and USD sub-values */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 500 }}>
              {balanceHidden ? '≈ •••• TON' : `≈ ${tonDisplay} TON`}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 500 }}>
              {balanceHidden ? '≈ $••••' : `≈ $${usdDisplay}`}
            </span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(10px, 4vw, 22px)', flexWrap: 'wrap', maxWidth: '100%' }}>

            {/* Withdraw */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <button
                onClick={() => setShowWithdrawPopup(true)}
                style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                  border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(61,21,128,0.4)',
                }}
                className="active:scale-90 transition-transform"
              >
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20V5"/><path d="m6 11 6-6 6 6"/><path d="M4 20h16"/>
                </svg>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.48)' }}>Withdraw</span>
            </div>

            {/* Code */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <button onClick={() => setShowPromoPopup(true)} style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(61,21,128,0.4)',
              }} className="active:scale-90 transition-transform">
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16v12H4z"/><path d="M4 10a2 2 0 0 0 0 4M20 10a2 2 0 0 1 0 4"/><path d="M12 6v12" strokeDasharray="1.5 2"/>
                </svg>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.48)' }}>Promo</span>
            </div>

            {/* Staking */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <button onClick={() => setShowStakingPopup(true)} style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(61,21,128,0.4)',
              }} className="active:scale-90 transition-transform">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.48)' }}>Staking</span>
            </div>


          </div>
      </div>

      {/* Scrollable Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px clamp(12px, 4vw, 20px)', paddingBottom: 'max(90px, calc(env(safe-area-inset-bottom, 0px) + 90px))', width: '100%' }}>

        {/* DAILY REWARDS */}
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '0.02em' }}>
            Daily Rewards
          </span>
        </div>

        <div style={{
          background: '#252525', borderRadius: 14,
          marginBottom: 20, overflow: 'hidden',
        }}>
          {/* Daily Check-In */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <polyline points="9 16 11 18 15 14"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Check-In</div>
            </div>
            <button
              onClick={() => setCheckinSheetOpen(true)}
              disabled={dailyChecked || dailyAdLoading || dailyCheckMutation.isPending}
              style={{
                background: dailyChecked ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: dailyChecked ? 'rgba(255,255,255,0.3)' : '#fff',
                border: 'none',
                width: 92, height: 38, borderRadius: 12, padding: 0, fontSize: 12, fontWeight: 800,
                cursor: (dailyChecked || dailyAdLoading) ? 'not-allowed' : 'pointer',
                flexShrink: 0, letterSpacing: '0.03em', whiteSpace: 'nowrap', justifyContent: 'center',
                boxShadow: dailyChecked ? 'none' : '0 2px 12px rgba(61,21,128,0.4)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
              className="active:scale-95 transition-transform"
            >
              {(dailyAdLoading || dailyCheckMutation.isPending) ? (
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              ) : dailyChecked ? 'DONE' : 'CHECK'}
            </button>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />

          {/* Mystery Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Mystery Box</div>
            </div>
            <button
              onClick={handleMysteryOpen}
              disabled={mysteryOpened || mysteryPhase !== 'idle'}
              style={{
                background: mysteryOpened ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: mysteryOpened ? 'rgba(255,255,255,0.3)' : '#fff',
                border: 'none',
                width: 92, height: 38, borderRadius: 12, padding: 0, fontSize: 12, fontWeight: 800,
                cursor: mysteryOpened ? 'not-allowed' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: mysteryOpened ? 'none' : '0 2px 12px rgba(61,21,128,0.4)',
              }}
              className="active:scale-95 transition-transform"
            >
              {mysteryOpened ? 'DONE' : 'OPEN'}
            </button>
          </div>
        </div>

        {/* FARMING label */}
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '0.02em' }}>
            Farming
          </span>
        </div>

        {/* FARMING */}
        <div style={{ background: '#252525', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
          {/* Main row: coin + counting */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px' }}>
            <img src="/assets/gem-icon.png" alt="Gold" style={{ width: 50, height: 50, flexShrink: 0, objectFit: 'contain', display: 'block' }} />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              {(() => {
                const val = farmAccum.toFixed(3);
                const [intPart, decPart] = val.split('.');
                return (
                  <div style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 'clamp(24px, 8vw, 36px)', fontWeight: 800 }}>{intPart}</span>
                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 'clamp(16px, 5vw, 22px)', fontWeight: 700 }}>.{decPart}</span>
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, fontWeight: 600, marginLeft: 5 }}>Gold</span>
                  </div>
                );
              })()}
              <div style={{ color: 'rgba(255,255,255,0.32)', fontSize: 12, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(farmData?.effectiveRate ?? FARM_RATE).toFixed(4)} Gold/hour · {farmData?.multiplier ?? 1}x boost</div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

          {/* Info and Boost stay inside the original card */}
          <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <button onClick={() => setShowFarmInfo(true)} aria-label="Farming info" style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, fontWeight: 800 }} className="active:scale-95 transition-transform"><Info size={18} strokeWidth={2} /> INFO</button>
              <div style={{ width: 1, background: 'rgba(255,255,255,0.05)' }} />
              <button onClick={() => setShowAlertPopup(true)} aria-label="Mining boost" style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#fff', fontSize: 11, fontWeight: 800 }} className="active:scale-95 transition-transform"><Rocket size={18} strokeWidth={1.8} /> BOOST</button>
          </div>
        </div>

        {/* Start/Claim control is intentionally detached from the card */}
        <div style={{ marginTop: 12 }}>
          {(() => {
            const isActive = farmData?.isActive;
            const isPending = farmStartMutation.isPending || farmClaimMutation.isPending;
            if (isPending) return (
              <button disabled style={{ width: '100%', padding: '12px 0', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, cursor: 'default' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.4)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                {farmClaimMutation.isPending ? 'Claiming…' : 'Starting…'}
              </button>
            );
            if (isActive && farmCountdown <= 0) return (
              <button onClick={() => farmClaimMutation.mutate()} style={{ width: '100%', padding: '12px 0', background: '#16a34a', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }} className="active:scale-95 transition-transform">
                CLAIM
              </button>
            );
            if (isActive) return (
              <div style={{ width: '100%', padding: '12px 0', background: '#eab308', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.03em' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>MINING · {fmtCountdown(farmCountdown)}</span>
              </div>
            );
            return (
              <button onClick={() => farmStartMutation.mutate()} style={{ width: '100%', padding: '12px 0', background: '#dc2626', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }} className="active:scale-95 transition-transform">
                START MINING
              </button>
            );
          })()}
        </div>

        {/* Farm Info Popup — bottom sheet */}
        {showFarmInfo && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={() => setShowFarmInfo(false)} />
            <div style={{ position: 'relative', width: '100%', background: 'linear-gradient(160deg, #0d0d0f, #111118)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '28px 28px 0 0', padding: '28px 20px', paddingBottom: 'max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />
              <div style={{ color: '#fff', fontSize: 19, fontWeight: 900, textAlign: 'center', marginBottom: 22 }}>Farming Info</div>
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '4px 0', marginBottom: 20 }}>
                {[
                  { label: 'Mining speed', val: '23.9574 Gold/hour' },
                  { label: 'Cycle duration', val: '1 hour' },
                  { label: 'Base per cycle', val: '23.9574 Gold' },
                  { label: 'Claim', val: 'After 1 hour only' },
                  { label: 'Boost levels', val: '1x → 25x' },
                ].map((r, i, arr) => (
                  <div key={r.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{r.label}</span>
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{r.val}</span>
                    </div>
                    {i < arr.length - 1 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
                  </div>
                ))}
              </div>
              <button onClick={() => setShowFarmInfo(false)} style={{ width: '100%', padding: '14px 0', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 800, cursor: 'pointer' }} className="active:scale-95 transition-transform">Got it</button>
            </div>
          </div>
        )}

        {/* Speed Up Popup — bottom sheet */}

        {/* Alert Popup — bottom sheet */}
        {showAlertPopup && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={() => setShowAlertPopup(false)} />
            <div style={{ position: 'relative', width: '100%', background: 'linear-gradient(160deg, #0d0d0f, #111118)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '28px 28px 0 0', padding: '28px 20px', paddingBottom: 'max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Upgrade multiplier</div>
                <div style={{ width: '100%', background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '12px 14px', boxSizing: 'border-box', marginBottom: 14 }}>
                  <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 }}>Current boost</div>
                  <div style={{ color: '#c084fc', fontSize: 24, fontWeight: 900 }}>{farmData?.multiplier ?? 1}x</div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 3 }}>Watch an ad to unlock the next level: {(FARM_BOOSTS[Math.min(FARM_BOOSTS.length - 1, Number(farmData?.boostStep ?? 0) + 1)] ?? 25)}x</div>
                </div>
                <button onClick={() => farmBoostMutation.mutate()} disabled={!farmData?.isActive || farmBoostMutation.isPending || Number(farmData?.multiplier ?? 1) >= 25} style={{ width: '100%', padding: '14px 0', background: 'linear-gradient(135deg, #2563eb, #3b82f6)', border: 0, borderRadius: 14, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: (!farmData?.isActive || farmBoostMutation.isPending || Number(farmData?.multiplier ?? 1) >= 25) ? .45 : 1, marginBottom: 9 }} className="active:scale-95 transition-transform">{farmBoostMutation.isPending ? 'Watching ad…' : Number(farmData?.multiplier ?? 1) >= 25 ? 'Maximum boost reached' : 'Watch ad to boost'}</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {showPromoPopup && (
        <div style={{ position:'fixed', inset:0, zIndex:1200, display:'flex', alignItems:'flex-end' }}>
          <div onClick={() => setShowPromoPopup(false)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.75)', backdropFilter:'blur(8px)' }} />
          <div onClick={e => e.stopPropagation()} style={{ position:'relative', width:'100%', background:'#0a0a0a', borderRadius:'28px 28px 0 0', padding:'24px 16px max(38px, calc(env(safe-area-inset-bottom, 0px) + 20px))', boxSizing:'border-box', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
            <div style={{ width:40, height:4, borderRadius:3, background:'rgba(255,255,255,.1)', margin:'0 auto 20px' }} />
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', marginBottom:16, paddingTop:2 }}><span style={{ color:'#fff', fontSize:18, fontWeight:900 }}>Promo Code</span></div>
            <PromoCodeInput />
          </div>
        </div>
      )}

      {false && showSwapPopup && (
        <SwapPopup
          onClose={() => setShowSwapPopup(false)}
          cipherBalance={Math.floor(axnRaw)}
          swapRate={100000}
          swapMin={Math.max(1, Number((user as any)?.minimumCashoutGold || 100000))}
          onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); }}
        />
      )}

      {/* Staking Popup */}
      {showStakingPopup && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={() => setShowStakingPopup(false)} />
          <div style={{
            position: 'relative', width: '100%',
            background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
            border: '1px solid rgba(61,21,128,0.3)',
            borderRadius: '28px 28px 0 0', padding: '28px 20px', paddingBottom: 'max(52px, calc(env(safe-area-inset-bottom, 0px) + 28px))', zIndex: 901, textAlign: 'center',
            boxShadow: '0 -8px 60px rgba(61,21,128,0.24), 0 0 0 1px rgba(255,255,255,0.03)',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)', animation: 'popup-glow 2s ease-in-out infinite' }} />
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px',
              background: 'linear-gradient(135deg, rgba(61,21,128,0.24), rgba(107,33,168,0.12))',
              border: '1px solid rgba(61,21,128,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 28px rgba(61,21,128,0.3)',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 8 }}>Gold Staking</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)', marginBottom: 10, lineHeight: 1.55 }}>
              Stake your Gold to earn passive rewards.
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 50, padding: '5px 14px', marginBottom: 28,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'axn-pulse 1.5s ease-in-out infinite' }} />
              <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700 }}>Launching Soon</span>
            </div>
            <button onClick={() => setShowStakingPopup(false)} style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              border: 'none', borderRadius: 50, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(61,21,128,0.4)',
            }} className="active:scale-95 transition-transform">Got it</button>
          </div>
        </div>
      )}


      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
      <DailyCheckinSheet
        open={checkinSheetOpen}
        onClose={() => setCheckinSheetOpen(false)}
        streak={checkinStatus?.streak ?? 0}
        dayIndex={checkinStatus?.dayIndex ?? 0}
        alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? dailyChecked}
        onClaimed={() => { setDailyChecked(true); setCheckinSheetOpen(false); queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); queryClient.invalidateQueries({ queryKey: ['/api/daily-checkin/status'] }); }}
      />
      <GameWithdrawPopup open={showWithdrawPopup} onClose={() => setShowWithdrawPopup(false)} userBalance={Math.floor(axnRaw)} />
      <BottomNav />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _SendChoicePopupRemoved({ user, onClose, onWithdraw, onSuccess }: {
  user: any;
  onClose: () => void;
  onWithdraw: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<null | 'user'>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const usdPreview = '';

  const handleSend = async () => {
    if (!recipient || !amount) { showNotification('Fill in recipient and amount', 'error'); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) { showNotification('Enter a valid amount', 'error'); return; }
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/transfers/send', { recipient, amount: num, note });
      const data = await res.json();
      if (data.success) {
        showNotification(`Sent ${num} Gold successfully!`, 'success');
        onSuccess();
      } else {
        showNotification(data.message || 'Transfer failed', 'error');
      }
    } catch {
      showNotification('Transfer failed. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '13px 14px', borderRadius: 14,
    border: '1.5px solid rgba(61,21,128,0.24)',
    fontSize: 15, color: '#fff',
    background: 'rgba(255,255,255,0.04)', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(61,21,128,0.3)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(61,21,128,0.24), 0 0 0 1px rgba(255,255,255,0.03)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mode ? 22 : 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode && (
              <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              </button>
            )}
            <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
              {mode === 'user' ? 'Send to User' : 'Send Gold'}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {!mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => setMode('user')} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'rgba(61,21,128,0.09)', border: '1px solid rgba(61,21,128,0.2)',
              borderRadius: 18, padding: '18px 20px', cursor: 'pointer', textAlign: 'left',
            }} className="active:scale-[0.98] transition-transform">
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(61,21,128,0.4)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2" fill="white" stroke="none" opacity="0.9"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Send to User</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>Internal transfer using User ID</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            <button onClick={onWithdraw} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.18)',
              borderRadius: 18, padding: '18px 20px', cursor: 'pointer', textAlign: 'left',
            }} className="active:scale-[0.98] transition-transform">
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #5b21b6, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(124,58,237,0.4)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Withdraw</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>Send to external TON wallet</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        )}

        {mode === 'user' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipient User ID</div>
              <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Enter User ID..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount (Gold)</div>
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0" style={inputStyle} />
              {usdPreview && <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 5 }}>{usdPreview}</div>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Note (optional)</div>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note..." style={inputStyle} />
            </div>
            <button
              onClick={handleSend}
              disabled={loading}
              style={{
                width: '100%', padding: '14px',
                background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                border: 'none', borderRadius: 14, color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
                fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(61,21,128,0.4)',
              }}
              className="active:scale-95 transition-transform"
            >
              {loading ? 'Sending...' : 'Send Gold'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _ReceivePopupRemoved({ user, onClose }: { user: any; onClose: () => void }) {
  const copyId = () => {
    const id = user?.id?.toString() || '';
    navigator.clipboard.writeText(id).then(() => showNotification('User ID copied!', 'success')).catch(() => {});
  };
  const copyUsername = () => {
    const un = user?.username || '';
    navigator.clipboard.writeText(un).then(() => showNotification('Username copied!', 'success')).catch(() => {});
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(61,21,128,0.3)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(61,21,128,0.24)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>Receive Gold</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 20 }}>
          Share your User ID or username so others can send you Gold directly.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>User ID</div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: 'Roboto Mono' }}>{user?.id ?? '—'}</div>
            </div>
            <button onClick={copyId} style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', border: 'none', borderRadius: 9, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy</button>
          </div>
          {user?.username && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Username</div>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: 'Roboto Mono' }}>@{user.username}</div>
              </div>
              <button onClick={copyUsername} style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', border: 'none', borderRadius: 9, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SwapPopup({ onClose, cipherBalance, swapRate, swapMin, onSuccess }: { onClose: () => void; cipherBalance: number; swapRate: number; swapMin: number; onSuccess: () => void }) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const RATE = swapRate;
  const MIN_GOLD = swapMin;
  const parsed = parseInt(amount) || 0;
  const rounded = Math.floor(parsed);
  const axnOut = rounded / RATE;
  const canSwap = rounded >= MIN_GOLD && rounded <= cipherBalance;
  const maxAmount = Math.floor(cipherBalance);

  const handleSwap = async () => {
    if (!canSwap || loading) return;
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/convert-to-usd', { powAmount: rounded, convertTo: 'USD' });
      const data = await res.json();
      if (data.success) {
        showNotification(`✅ Swapped ${rounded.toLocaleString()} GOLD → $${axnOut.toFixed(4)} USDT`, 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        onSuccess();
        onClose();
      } else {
        showNotification(data.message || 'Swap failed', 'error');
      }
    } catch (e: any) {
      let msg = 'Swap failed';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
    setLoading(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: '100%', background: 'linear-gradient(160deg, #0d0d0f, #111118)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '28px 28px 0 0', padding: '28px 20px', paddingBottom: 'max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <img src="/assets/gem-icon.png" alt="Gold" style={{ width: 44, height: 44, flexShrink: 0, objectFit: 'contain', display: 'block' }} />
          <div>
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 900 }}>Swap GOLD → USDT</div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>{RATE.toLocaleString()} GOLD = 1 USDT</div>
          </div>
        </div>

        {/* Info rows */}
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '4px 0', marginBottom: 16 }}>
          {[
            { label: 'Your GOLD', val: cipherBalance.toLocaleString() },
            { label: 'Minimum', val: `${MIN_GOLD.toLocaleString()} GOLD` },
            { label: 'You receive', val: axnOut > 0 ? `$${axnOut.toFixed(4)} USDT` : '—' },
          ].map((r, i, arr) => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{r.label}</span>
                <span style={{ color: i === 2 && axnOut > 0 ? '#4ade80' : '#fff', fontSize: 13, fontWeight: 700 }}>{r.val}</span>
              </div>
              {i < arr.length - 1 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
            </div>
          ))}
        </div>

        {/* Amount input row */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Amount</div>
            <button onClick={() => setAmount(String(maxAmount))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: 11, fontWeight: 700, padding: 0 }}>MAX</button>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 16px' }}>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={`Min ${MIN_GOLD.toLocaleString()}`}
              style={{ flex: 1, padding: '14px 0', background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 16, fontWeight: 700 }}
            />
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 700 }}>GOLD</span>
          </div>
        </div>

        {/* Swap button */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || loading}
          style={{
            width: '100%', padding: '14px 0', border: 'none', borderRadius: 14,
            background: canSwap && !loading ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)' : 'rgba(255,255,255,0.06)',
            color: canSwap && !loading ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize: 14, fontWeight: 800, cursor: canSwap && !loading ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          className={canSwap && !loading ? 'active:scale-95 transition-transform' : ''}
        >
          {loading && <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
          {loading ? 'Swapping…' : canSwap ? `Swap ${rounded.toLocaleString()} GOLD → $${axnOut.toFixed(4)} USDT` : 'Enter an amount'}
        </button>
      </div>
    </div>
  );
}

function PromoPopup({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'watching-ad' | 'redeeming'>('idle');

  const handleRedeem = async () => {
    if (!code.trim()) { showNotification('Enter a promo code', 'error'); return; }
    if (loading) return;
    setLoading(true);

    try {
      setAdStep('redeeming');
      const res = await apiRequest('POST', '/api/promo-codes/redeem', { code: code.trim() });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || 'Promo code redeemed!', 'success');
        onSuccess();
      } else {
        showNotification(data.message || 'Invalid promo code', 'error');
      }
    } catch {
      showNotification('Failed to redeem. Try again.', 'error');
    } finally {
      setLoading(false);
      setAdStep('idle');
    }
  };

  const buttonLabel = adStep === 'redeeming' ? 'Redeeming...' : 'Redeem';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={!loading ? onClose : undefined} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(61,21,128,0.3)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(61,21,128,0.24)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>Promo Code</span>
        </div>

        <div style={{ marginBottom: 8 }}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            disabled={loading}
            style={{
              width: '100%', padding: '14px', borderRadius: 14,
              border: '1.5px solid rgba(61,21,128,0.24)',
              fontSize: 15, color: '#fff', letterSpacing: '0.08em', fontWeight: 700,
              background: 'rgba(255,255,255,0.04)', outline: 'none',
              boxSizing: 'border-box', textAlign: 'center',
              opacity: loading ? 0.5 : 1,
            }}
          />
        </div>
        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>A short ad plays before your reward is unlocked</p>
        <button
          onClick={handleRedeem}
          disabled={loading}
          style={{
            width: '100%', padding: '14px',
            background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
            border: 'none', borderRadius: 14, color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
            fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 20px rgba(61,21,128,0.4)',
          }}
          className="active:scale-95 transition-transform"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
