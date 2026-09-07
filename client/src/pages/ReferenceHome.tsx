import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import IncomeStatistics from "@/components/IncomeStatistics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useAdmin } from "@/hooks/useAdmin";
import { useAdSession } from "@/hooks/useAdSession";
import { useLocation } from "wouter";
import { Clock, Loader2, Wallet, Ticket, Eye, EyeOff, ExternalLink, Shield, Play, Repeat, Layers, Share2, Cloud, Info, Rocket, Gift, CalendarCheck2, Zap } from "lucide-react";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import PromoCodeInput from "@/components/PromoCodeInput";
import { showAdgramAd } from "@/lib/showAd";
import AdvertiserTaskFeed from "@/components/AdvertiserTaskFeed";
import PopupShell from "@/components/PopupShell";




interface User {
  id?: string;
  telegramId?: string;
  balance?: string;
  usdBalance?: string;
  bugBalance?: string;
  lastStreakDate?: string;
  username?: string;
  firstName?: string;
  telegramUsername?: string;
  referralCode?: string;
  [key: string]: any;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ─── ResetCountdownBanner ────────────────────────────────────────────────────
// Previously the reset-countdown state lived in Home, causing the entire
// 1100-line component to re-render every second (two 1s intervals × 60/min).
// Isolating it here means only this tiny component re-renders on each tick.
const CARD = 'rgba(255,255,255,0.07)';
const TEXT = '#fff';
const TEXT_DIM = 'rgba(255,255,255,0.35)';
const BLUE = '#3b82f6';



// ─────────────────────────────────────────────────────────────────────────────

export default function Home({ missionOnly = false }: { missionOnly?: boolean }) {
  const { user, isLoading, isFetching, dataUpdatedAt } = useAuth();
  const { isAdmin } = useAdmin();
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const [, setLocation] = useLocation();

  const [isConverting, setIsConverting] = useState(false);
  const [isClaimingStreak, setIsClaimingStreak] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(false);
  const [timeUntilNextClaim, setTimeUntilNextClaim] = useState<string>("");
  
  const [promoPopupOpen, setPromoPopupOpen] = useState(false);
  const [boosterPopupOpen, setBoosterPopupOpen] = useState(false);
  const [giftPopupOpen, setGiftPopupOpen] = useState(false);
  const [isEarning, setIsEarning] = useState(false);
  const [goldBalanceHidden, setGoldBalanceHidden] = useState(false);
  const goldBalance = Math.floor(Number.parseFloat(String(user?.balance ?? '0')) || 0);
  const goldBalanceDisplay = goldBalance.toLocaleString();
  const MINING_DURATION_SECONDS = 2 * 60 * 60 + 46 * 60 + 22;
  const [miningSecondsLeft, setMiningSecondsLeft] = useState(MINING_DURATION_SECONDS);
  const MINING_SESSION_START_AMOUNT = 0.00005727;
  const [minedGold, setMinedGold] = useState(MINING_SESSION_START_AMOUNT);
  const [isMiningComplete, setIsMiningComplete] = useState(false);
  const [durationPopupOpen, setDurationPopupOpen] = useState(false);
  const [watchAdPopupOpen, setWatchAdPopupOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState('1HR');
  const [purchaseDuration, setPurchaseDuration] = useState<string | null>(null);
  const MINING_DURATIONS = ['1HR', '2HR', '4HR', '8HR', '12HR'] as const;
  const MINING_DURATION_SECONDS_BY_OPTION: Record<string, number> = {
    '1HR': 60 * 60,
    '2HR': 2 * 60 * 60,
    '4HR': 4 * 60 * 60,
    '8HR': 8 * 60 * 60,
    '12HR': 12 * 60 * 60,
  };
  const PAID_DURATION_PRICES: Record<string, string> = {
    '2HR': '2.99 TON',
    '4HR': '5.49 TON',
    '8HR': '9.49 TON',
    '12HR': '14.99 TON',
  };

  React.useEffect(() => {
    if (!isEarning || isMiningComplete) return;
    const timer = window.setInterval(() => {
      setMiningSecondsLeft((previous) => {
        const next = Math.max(0, previous - 1);
        const progress = 1 - next / MINING_DURATION_SECONDS;
        setMinedGold(Number((MINING_SESSION_START_AMOUNT + (5 - MINING_SESSION_START_AMOUNT) * progress).toFixed(8)));
        if (next === 0) setIsMiningComplete(true);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isEarning, isMiningComplete]);

  const miningProgress = Math.min(100, ((MINING_DURATION_SECONDS - miningSecondsLeft) / MINING_DURATION_SECONDS) * 100);
  const miningTime = `${String(Math.floor(miningSecondsLeft / 3600)).padStart(2, '0')}H:${String(Math.floor((miningSecondsLeft % 3600) / 60)).padStart(2, '0')}M:${String(miningSecondsLeft % 60).padStart(2, '0')}S`;
  const sessionTimeLeft = `${Math.floor(miningSecondsLeft / 3600)}h ${Math.floor((miningSecondsLeft % 3600) / 60)}m ${miningSecondsLeft % 60}s`;
  const rawMiningSpeed = (user as User)?.hashrate ?? (user as User)?.hashRate ?? (user as User)?.miningHashrate ?? (user as User)?.miningSpeed ?? '1 MH/s';
  const miningSpeed = typeof rawMiningSpeed === 'number' ? `${rawMiningSpeed} MH/s` : String(rawMiningSpeed || '1 MH/s');

  const startMiningForDuration = (duration: string) => {
    const seconds = MINING_DURATION_SECONDS_BY_OPTION[duration] || MINING_DURATION_SECONDS;
    setMiningSecondsLeft(seconds);
    setMinedGold(MINING_SESSION_START_AMOUNT);
    setIsMiningComplete(false);
    setIsEarning(true);
    setDurationPopupOpen(false);
  };

  const handleDurationConfirm = () => {
    setDurationPopupOpen(false);
    setWatchAdPopupOpen(true);
  };

  const handleWatchAdProceed = async () => {
    setWatchAdPopupOpen(false);
    const monetagResult = await showMonetagRewardedAd();

    if (!monetagResult.success) {
      showNotification(monetagResult.unavailable ? "Rewarded ads are not available right now. Please try again later." : "Please watch the ad completely to continue.", "error");
      return;
    }

    if (selectedDuration === '1HR') {
      startMiningForDuration(selectedDuration);
    } else {
      setPurchaseDuration(selectedDuration);
    }
  };

  const handleCloudEarnerAction = () => {
    if (!isEarning) {
      setSelectedDuration('1HR');
      setDurationPopupOpen(true);
      return;
    }
    if (!isMiningComplete) return;
    showNotification(`${minedGold.toFixed(4)} FONE claimed!`, 'success');
    setIsEarning(false);
    setMiningSecondsLeft(MINING_DURATION_SECONDS);
    setMinedGold(MINING_SESSION_START_AMOUNT);
    setIsMiningComplete(false);
  };



  // Daily Check-In & Mystery Gift state
  const [dailyChecked, setDailyChecked] = useState(() => localStorage.getItem('daily_check_date') === getTodayKey());
  const [dailyAdLoading, setDailyAdLoading] = useState(false);
  const [mysteryClaimsToday, setMysteryClaimsToday] = useState(0);
  const MYSTERY_DAILY_LIMIT = 5;
  const mysteryOpened = mysteryClaimsToday >= MYSTERY_DAILY_LIMIT;
  const [mysteryAdLoading, setMysteryAdLoading] = useState(false);
  
  // Legacy daily missions removed from state

  // 7-day check-in streak bottom sheet
  const [checkinSheetOpen, setCheckinSheetOpen] = useState(false);
  const checkinSheetShownRef = React.useRef(false);
  const { data: checkinStatus, isSuccess: checkinStatusReady } = useQuery<any>({
    queryKey: ['/api/daily-checkin/status'],
    queryFn: async () => {
      const res = await fetch('/api/daily-checkin/status', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  // Auto-show the check-in sheet on app open — only when today is not yet claimed.
  // Uses a small polling fallback so the sheet still opens in Telegram (where
  // the query may stay in a loading/paused state while the webview warms up).
  React.useEffect(() => {
    if (checkinSheetShownRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tryShow = () => {
      if (cancelled || checkinSheetShownRef.current) return;
      if (!checkinStatus) return;
      checkinSheetShownRef.current = true;
      if (!checkinStatus.alreadyClaimedToday) {
        setCheckinSheetOpen(true);
      }
    };
    if (checkinStatusReady && checkinStatus) {
      tryShow();
    } else {
      // Fallback: keep checking every 700ms for up to 8s until status arrives
      timer = setInterval(() => {
        if (checkinStatus) tryShow();
      }, 700);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [checkinStatusReady, checkinStatus]);




  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  // Env-based AdsGram and approved rewarded-ad provider configuration.
  const { data: appConfig } = useQuery<any>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: userData } = useQuery<{ referralCode?: string }>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });




  // Sync daily check-in & mystery gift state from server user data
  useEffect(() => {
    const typedUser = user as User;
    if (!typedUser) return;
    const todayKey = getTodayKey();
    if (typedUser.dailyCheckinClaimed && typedUser.dailyTasksDate) {
      const serverDate = new Date(typedUser.dailyTasksDate).toISOString().slice(0, 10);
      if (serverDate === todayKey) {
        setDailyChecked(true);
        localStorage.setItem('daily_check_date', todayKey);
      } else {
        setDailyChecked(false);
        localStorage.removeItem('daily_check_date');
      }
    } else if (typedUser.dailyCheckinClaimed === false) {
      setDailyChecked(false);
      localStorage.removeItem('daily_check_date');
    }
    if (typedUser.mysteryBoxDate) {
      const serverDate = new Date(typedUser.mysteryBoxDate).toISOString().slice(0, 10);
      setMysteryClaimsToday(serverDate === todayKey ? (typedUser.mysteryBoxCount ?? 0) : 0);
    } else {
      setMysteryClaimsToday(0);
    }
  }, [user]);



  React.useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const typedUser = user as User;
      
      if (typedUser?.id) {
        const claimedTimestamp = localStorage.getItem(`streak_claimed_${typedUser.id}`);
        if (claimedTimestamp) {
          const claimedDate = new Date(claimedTimestamp);
          const nextClaimTime = new Date(claimedDate.getTime() + 5 * 60 * 1000);
          
          if (now.getTime() < nextClaimTime.getTime()) {
            setHasClaimed(true);
            const diff = nextClaimTime.getTime() - now.getTime();
            const minutes = Math.floor(diff / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setTimeUntilNextClaim(`${minutes}:${seconds.toString().padStart(2, '0')}`);
            return;
          } else {
            setHasClaimed(false);
            localStorage.removeItem(`streak_claimed_${typedUser.id}`);
          }
        }
      }
      
      if ((user as User)?.lastStreakDate) {
        const lastClaim = new Date((user as User).lastStreakDate!);
        const minutesSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1000 * 60);
        
        if (minutesSinceLastClaim < 5) {
          setHasClaimed(true);
          const nextClaimTime = new Date(lastClaim.getTime() + 5 * 60 * 1000);
          const diff = nextClaimTime.getTime() - now.getTime();
          const minutes = Math.floor(diff / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setTimeUntilNextClaim(`${minutes}:${seconds.toString().padStart(2, '0')}`);
          return;
        }
      }
      
      setHasClaimed(false);
      setTimeUntilNextClaim("Available now");
    };

    updateTimer();
    // Root cause of Issue 1: 1-second interval caused the entire 1100-line Home
    // component to re-render 60x per minute. Claim availability only needs
    // ~5-second precision — the button transitions idle→available, not a clock.
    const interval = setInterval(updateTimer, 5000);
    return () => clearInterval(interval);
  }, [(user as User)?.lastStreakDate, (user as User)?.id]);

  const convertMutation = useMutation({
    mutationFn: async ({ amount, convertTo }: { amount: number; convertTo: string }) => {
      const res = await fetch("/api/convert-to-usd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ powAmount: amount, convertTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to convert");
      }
      return data;
    },
    onSuccess: async (data) => {
      showNotification("Convert successful.", "success");

      // Instantly update cache with new balance values from server response
      if (data.newPowBalance !== undefined || data.newUsdBalance !== undefined) {
        queryClient.setQueryData(["/api/auth/user"], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            ...(data.newPowBalance !== undefined && { balance: String(Math.round(data.newPowBalance)) }),
            ...(data.newUsdBalance !== undefined && { usdBalance: data.newUsdBalance }),
            ...(data.newTonBalance !== undefined && { tonBalance: data.newTonBalance }),
            ...(data.newStarBalance !== undefined && { starBalance: data.newStarBalance }),
          };
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
    },
    onError: (error: Error) => {
      showNotification(error.message, "error");
    },
  });

  const claimStreakMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/streak/claim");
      if (!response.ok) {
        const error = await response.json();
        const errorObj = new Error(error.message || 'Failed to claim streak');
        (errorObj as any).isAlreadyClaimed = error.message === "Please wait 5 minutes before claiming again!";
        throw errorObj;
      }
      return response.json();
    },
    onSuccess: (data) => {
      setHasClaimed(true);
      const typedUser = user as User;
      if (typedUser?.id) {
        localStorage.setItem(`streak_claimed_${typedUser.id}`, new Date().toISOString());
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      const rewardAmount = parseFloat(data.rewardEarned || '0');
      if (rewardAmount > 0) {
        const earnedGold = Math.round(rewardAmount);
        showNotification(`You've claimed +${earnedGold} Gold!`, "success");
      } else {
        showNotification("You've claimed your streak bonus!", "success");
      }
    },
    onError: (error: any) => {
      const notificationType = error.isAlreadyClaimed ? "info" : "error";
      showNotification(error.message || "Failed to claim streak", notificationType);
      if (error.isAlreadyClaimed) {
        setHasClaimed(true);
        const typedUser = user as User;
        if (typedUser?.id) {
          localStorage.setItem(`streak_claimed_${typedUser.id}`, new Date().toISOString());
        }
      }
    },
    onSettled: () => {
      setIsClaimingStreak(false);
    },
  });

  const redeemPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Invalid promo code");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      setPromoPopupOpen(false);
      setIsApplyingPromo(false);
      showNotification(data.message || "Promo applied successfully!", "success");
    },
    onError: (error: any) => {
      const message = error.message || "Invalid promo code";
      showNotification(message, "error");
      setIsApplyingPromo(false);
    },
  });

  // Server-verified AdsGram flow for daily rewards. The provider remains
  // available for these existing reward contexts even while its main card is
  // hidden from AdWatchingSection pending platform approval.
  const { startSession, endSession, cancelSession, waitForForeground } = useAdSession();
  const runVerifiedAdgramAd = async (context: 'daily_checkin' | 'mystery_box') => {
    const sessionId = startSession();
    try {
      const regRes = await apiRequest('POST', '/api/ads/register-session', {
        sessionId, adType: 'adsgram', context,
      });
      if (!regRes.ok) throw new Error('Could not start ad session');
      const blockId = context === 'mystery_box'
        ? (appConfig?.adsgramMysteryBoxBlockId || '')
        : (appConfig?.adsgramCheckinBlockId || '');
      await showAdgramAd(blockId);
      await waitForForeground();
      const session = endSession();
      return {
        sessionId: session.sessionId,
        backgroundEntered: session.backgroundEntered,
        backgroundDuration: session.backgroundDuration,
      };
    } catch (err) {
      cancelSession();
      throw err;
    }
  };

  // Daily Check-In mutation (calls /api/daily-checkin — distinct from missions daily-checkin)
  const dailyCheckMutation = useMutation({
    mutationFn: async (proof: { sessionId: string; backgroundEntered: boolean; backgroundDuration: number }) => {
      const res = await apiRequest('POST', '/api/daily-checkin', proof);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      return data;
    },
    onSuccess: (data) => {
      setDailyChecked(true);
      localStorage.setItem('daily_check_date', getTodayKey());
      showNotification(`Daily check-in done! +${data.reward ?? 0.001} GRAM added`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Daily check-in failed. Try again.', 'error');
    },
  });

  const handleDailyCheck = async () => {
    if (dailyChecked || dailyAdLoading || dailyCheckMutation.isPending) return;
    setDailyAdLoading(true);
    try {
      const proof = await runVerifiedAdgramAd('daily_checkin');
      await dailyCheckMutation.mutateAsync(proof);
    } catch {
      showNotification('Ad was not completed. Daily check-in reward was not granted.', 'error');
    } finally {
      setDailyAdLoading(false);
    }
  };

  const handleMysteryOpen = async () => {
    if (mysteryOpened || mysteryAdLoading) return;
    setMysteryAdLoading(true);
    let proof: { sessionId: string; backgroundEntered: boolean; backgroundDuration: number };
    try {
      proof = await runVerifiedAdgramAd('mystery_box');
    } catch {
      setMysteryAdLoading(false);
      showNotification('Ad was not completed. No Mystery Gift reward was granted.', 'error');
      return;
    }
    try {
      const res = await apiRequest('POST', '/api/mystery-box', proof);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      if (typeof data.claimsToday === 'number') setMysteryClaimsToday(data.claimsToday);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification('Mystery Gift reward added to your balance in Gold.', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to open mystery box. Try again.', 'error');
    } finally {
      setMysteryAdLoading(false);
    }
  };



  // Monetag show fn resolved from the env-based zone id (MONETAG_ZONE_ID)
  const showMonetagAd = (): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      const showFn = (window as any)[`show_${appConfig?.monetagZoneId || ''}`];
      if (typeof showFn === 'function') {
        showFn()
          .then(() => {
            resolve({ success: true, unavailable: false });
          })
          .catch((error: any) => {
            console.error('Monetag ad error:', error);
            resolve({ success: false, unavailable: false });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });
  };

  const showMonetagRewardedAd = (): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      console.log('🎬 Attempting to show Monetag rewarded ad...');
      const showFn = (window as any)[`show_${appConfig?.monetagZoneId || ''}`];
      if (typeof showFn === 'function') {
        console.log('✅ Monetag SDK found, calling rewarded ad...');
        showFn()
          .then(() => {
            console.log('✅ Monetag rewarded ad completed successfully');
            resolve({ success: true, unavailable: false });
          })
          .catch((error: any) => {
            console.error('❌ Monetag rewarded ad error:', error);
            resolve({ success: false, unavailable: false });
          });
      } else {
        console.log('⚠️ Monetag SDK not available, skipping ad');
        resolve({ success: false, unavailable: true });
      }
    });
  };



  const handleClaimStreak = async () => {
    if (isClaimingStreak || hasClaimed) return;
    
    setIsClaimingStreak(true);
    
    try {
      const monetagResult = await showMonetagRewardedAd();
      
      if (monetagResult.unavailable || !monetagResult.success) {
        showNotification(monetagResult.unavailable ? "Rewarded ads are not available right now. Please try again later." : "Please watch the ad completely to claim your bonus.", "error");
        setIsClaimingStreak(false);
        return;
      }

      claimStreakMutation.mutate();
    } catch (error) {
      console.error('Streak claim failed:', error);
      showNotification("Failed to claim streak. Please try again.", "error");
      setIsClaimingStreak(false);
    }
  };

  // Legacy mission countdown effect removed

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      showNotification("Please enter a promo code", "error");
      return;
    }

    if (isApplyingPromo || redeemPromoMutation.isPending) return;
    
    setIsApplyingPromo(true);
    
    try {
      const monetagResult = await showMonetagRewardedAd();
      
      if (monetagResult.unavailable || !monetagResult.success) {
        showNotification(monetagResult.unavailable ? "Rewarded ads are not available right now. Please try again later." : "Please watch the ad to claim your promo code.", "error");
        setIsApplyingPromo(false);
        return;
      }
      
      redeemPromoMutation.mutate(promoCode.trim().toUpperCase());
    } catch (error) {
      console.error('Promo claim error:', error);
      showNotification("Something went wrong. Please try again.", "error");
      setIsApplyingPromo(false);
    }
  };

  const handleBoosterClick = () => {
    setBoosterPopupOpen(true);
  };



  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1 justify-center mb-4">
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <div className="text-foreground font-medium">{t('loading')}</div>
        </div>
      </div>
    );
  }










  return (
    <Layout>
      <main
        className={missionOnly ? "mission-page w-full max-w-md mx-auto flex flex-col" : "home-reference-page w-full max-w-md mx-auto flex flex-col"}
        style={missionOnly ? {
          background: '#c8f05a',
          paddingTop: 12,
          paddingBottom: 8,
        } : undefined}
      >
        {!missionOnly && (
          <>
            <div className="home-reference-shell" aria-label="AXN mining home">
              <div className="home-reference-balance-carousel" aria-label="AXN balance and mining session cards">
                <section className="home-reference-balance" aria-label="Total balance">
                  <div className="home-reference-balance-topline">
                    <div>
                      <div className="home-reference-brand">AXN</div>
                      <div className="home-reference-eyebrow">Total Balance</div>
                    </div>
                    <Wallet className="home-reference-wallet" size={42} strokeWidth={1.7} aria-hidden="true" />
                  </div>

                  <div className="home-reference-balance-row">
                    <div className="home-reference-coin-balance">0.00479148</div>
                    <div className="home-reference-signal" aria-hidden="true">
                      <span className="home-reference-signal-dot" />
                      <span className="home-reference-signal-wave home-reference-signal-wave-one" />
                      <span className="home-reference-signal-wave home-reference-signal-wave-two" />
                      <span className="home-reference-signal-wave home-reference-signal-wave-three" />
                    </div>
                  </div>

                  <button type="button" className="home-reference-wallet-button" onClick={() => setLocation('/withdraw')}>
                    Open Wallet <span aria-hidden="true">›</span>
                  </button>
                </section>

                {isEarning && (
                  <section className="home-reference-session-card" aria-label="Active mining session">
                    <div className="home-reference-session-topline">
                      <div>
                        <div className="home-reference-session-brand">AXN</div>
                        <div className="home-reference-session-eyebrow">Mined This Session</div>
                      </div>
                      <Zap className="home-reference-session-icon" size={32} fill="currentColor" aria-hidden="true" />
                    </div>
                    <div className="home-reference-session-amount">{minedGold.toFixed(8)}</div>
                    <div className="home-reference-session-status"><span />{isMiningComplete ? 'Complete' : 'Active'}</div>
                    <div className="home-reference-session-stats">
                      <div><span>Speed</span><strong>{miningSpeed}</strong></div>
                      <div><span>Boost</span><strong>x1</strong></div>
                      <div><span>Time left</span><strong>{sessionTimeLeft}</strong></div>
                    </div>
                  </section>
                )}
              </div>

              <section className="home-reference-price-card" aria-label="AXN price">
                <div className="home-reference-price-brand">
                  <div className="home-reference-price-logo">
                    <img src="/axn-logo.jpg" alt="AXN" />
                  </div>
                  <div>
                    <div className="home-reference-price-title">AXN Price</div>
                    <div className="home-reference-price-subtitle">Launching Price</div>
                  </div>
                </div>
                <div className="home-reference-price-value">
                  <strong>$0.05</strong>
                </div>
              </section>

              {/* This is the existing action row. Labels, order, and handlers are intentionally unchanged. */}
              <div className="home-wallet-actions home-reference-actions" aria-label="Home actions">
                {[
                  { label: 'Boost', icon: Rocket, action: () => showNotification('Upgrade Multiplier is coming soon.', 'success') },
                  { label: 'Gift', icon: Gift, action: () => setGiftPopupOpen(true) },
                  { label: 'Check-in', icon: CalendarCheck2, action: () => setCheckinSheetOpen(true) },
                ].map((item) => {
                  const ActionIcon = item.icon;
                  return (
                    <button type="button" key={item.label} onClick={item.action} aria-label={item.label} className="home-wallet-action home-reference-action active:scale-95 transition-transform">
                      <span className="home-wallet-action-icon home-reference-action-icon"><ActionIcon size={24} strokeWidth={1.8} /></span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleCloudEarnerAction}
                disabled={isEarning && !isMiningComplete}
                className="home-start-mining home-reference-start active:scale-[0.99] transition-transform"
              >
                <span className="home-reference-start-icon" aria-hidden="true">ϟ</span>
                <span>{isEarning ? (isMiningComplete ? 'Claim Mining Reward' : 'Mining in Progress') : 'Start Mining'}</span>
              </button>

              <section className="home-reference-activity" aria-label="Recent activity">
                <div className="home-reference-section-heading">
                  <h2>Recent Activity</h2>
                  <button type="button" onClick={() => setLocation('/rewards')}>See All</button>
                </div>
                <article className="home-reference-activity-card">
                  <div className="home-reference-activity-icon"><span aria-hidden="true">ϟ</span></div>
                  <div className="home-reference-activity-copy">
                    <strong>Mining Reward</strong>
                    <span>31/8/2026</span>
                  </div>
                  <strong className="home-reference-activity-amount">0.00479148</strong>
                </article>
                <article className="home-reference-activity-card home-reference-activity-card-muted">
                  <div className="home-reference-activity-icon"><Gift size={22} strokeWidth={1.8} aria-hidden="true" /></div>
                  <div className="home-reference-activity-copy">
                    <strong>Daily Reward</strong>
                    <span>30/8/2026</span>
                  </div>
                  <strong className="home-reference-activity-amount">+100 GOLD</strong>
                </article>
              </section>
            </div>

            {giftPopupOpen && (
              <PopupShell onClose={() => setGiftPopupOpen(false)} maxWidth={340}>
                <div className="gift-reward-popup" role="dialog" aria-modal="true" aria-labelledby="gift-reward-title">
                  <div className="gift-reward-icon" aria-hidden="true"><Gift size={30} strokeWidth={1.8} /></div>
                  <h2 id="gift-reward-title">Gift Reward</h2>
                  <p className="gift-reward-amount">0.00016501 <span>Tokens</span></p>
                  <button
                    type="button"
                    className="gift-reward-claim"
                    onClick={() => {
                      setGiftPopupOpen(false);
                      showNotification('Gift reward claimed successfully.', 'success');
                    }}
                  >
                    Claim Now
                  </button>
                </div>
              </PopupShell>
            )}

            {durationPopupOpen && (
              <PopupShell onClose={() => setDurationPopupOpen(false)} maxWidth={360}>
                <div className="mining-duration-popup" role="dialog" aria-modal="true" aria-labelledby="duration-title">
                  <div className="mining-duration-icon" aria-hidden="true"><Clock size={28} strokeWidth={2} /></div>
                  <h2 id="duration-title">Select Duration</h2>
                  <p>Extend your session to mine more reward</p>
                  <div className="mining-duration-options" role="radiogroup" aria-label="Mining duration">
                    {MINING_DURATIONS.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        role="radio"
                        aria-checked={selectedDuration === duration}
                        className={selectedDuration === duration ? 'mining-duration-option is-selected' : 'mining-duration-option'}
                        onClick={() => setSelectedDuration(duration)}
                      >
                        {duration}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="mining-duration-confirm" onClick={handleDurationConfirm}>
                    Confirm Duration
                  </button>
                </div>
              </PopupShell>
            )}

            {watchAdPopupOpen && (
              <PopupShell onClose={() => setWatchAdPopupOpen(false)} maxWidth={360}>
                <div className="watch-ad-popup" role="dialog" aria-modal="true" aria-labelledby="watch-ad-title">
                  <div className="watch-ad-icon" aria-hidden="true"><Play size={26} fill="currentColor" /></div>
                  <h2 id="watch-ad-title">Watch ad?</h2>
                  <p>Watch a short video ad to proceed?</p>
                  <div className="watch-ad-actions">
                    <button type="button" className="watch-ad-proceed" onClick={handleWatchAdProceed}>Proceed</button>
                    <button type="button" className="watch-ad-cancel" onClick={() => setWatchAdPopupOpen(false)}>No, Thanks</button>
                  </div>
                </div>
              </PopupShell>
            )}

            {purchaseDuration && (
              <PopupShell onClose={() => setPurchaseDuration(null)} maxWidth={360}>
                <div className="mining-duration-popup" role="dialog" aria-modal="true" aria-labelledby="purchase-duration-title">
                  <div className="mining-duration-icon" aria-hidden="true"><Wallet size={28} strokeWidth={2} /></div>
                  <h2 id="purchase-duration-title">Unlock {purchaseDuration} Mining</h2>
                  <p>Purchase this session license to extend your daily mining potential</p>
                  <div className="mining-duration-price">{PAID_DURATION_PRICES[purchaseDuration]}</div>
                  <div className="mining-duration-purchase-actions">
                    <button
                      type="button"
                      className="mining-duration-cancel"
                      onClick={() => {
                        setPurchaseDuration(null);
                        setDurationPopupOpen(true);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mining-duration-confirm"
                      onClick={() => {
                        setPurchaseDuration(null);
                        showNotification(`${purchaseDuration} mining purchase flow is coming soon.`, 'success');
                      }}
                    >
                      Purchase Now
                    </button>
                  </div>
                </div>
              </PopupShell>
            )}

            {/* Render outside the transformed fixed dock so PopupShell covers the viewport correctly. */}
            <DailyCheckinSheet
              open={checkinSheetOpen}
              onClose={() => setCheckinSheetOpen(false)}
              streak={checkinStatus?.streak ?? 0}
              dayIndex={checkinStatus?.dayIndex ?? 0}
              alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? false}
              adsgramBlockId={appConfig?.adsgramCheckinBlockId || ''}
              onClaimed={() => {
                setCheckinSheetOpen(false);
                queryClient.invalidateQueries({ queryKey: ['/api/daily-checkin/status'] });
                queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
                queryClient.invalidateQueries({ queryKey: ['/api/missions/status'] });
              }}
            />
          </>
        )}

        {missionOnly && (
          <>
        <div className="mission-page-title">Missions</div>

        <section className="mission-section-card" aria-labelledby="mission-promo-title">
          <div className="mission-section-heading">
            <h2 id="mission-promo-title">Promo Code</h2>
            <p>Enter a promo code and get rewards.</p>
          </div>
          <PromoCodeInput />
        </section>
        <section className="mission-section-card" aria-labelledby="mission-social-title">
          <div className="mission-section-heading">
            <h2 id="mission-social-title">Social Tasks</h2>
            <p>Complete social tasks and get rewards.</p>
          </div>
          <AdvertiserTaskFeed
            kind="social"
            title="Social Tasks"
            subtitle="Complete social tasks and get rewards."
            showHeader={false}
          />
        </section>
        <section className="mission-section-card" aria-labelledby="mission-game-title">
          <div className="mission-section-heading">
            <h2 id="mission-game-title">Game Task</h2>
            <p>Launch games and get rewards.</p>
          </div>
          <AdvertiserTaskFeed
            kind="game"
            title="Game Task"
            subtitle="Launch game and get rewards"
            showHeader={false}
          />
        </section>
          </>
        )}

        {/* Small breathing room above the fixed bottom navigation */}
        <div style={{ height: missionOnly ? 4 : 12, flexShrink: 0 }} />
      </main>
    </Layout>
  );
}
