import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import IncomeStatistics from "@/components/IncomeStatistics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useAdmin } from "@/hooks/useAdmin";
import { useAdSession } from "@/hooks/useAdSession";
import { useLocation } from "wouter";
import { Clock, Loader2, Send, ExternalLink, Shield, Play, Repeat, Layers, Share2 } from "lucide-react";
import DailyCheckinSheet from "@/components/DailyCheckinSheet";
import { CHECKIN_REWARDS } from "@/components/DailyCheckinSheet";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import PromoCodeInput from "@/components/PromoCodeInput";
import DailyMissionTasks from "@/components/DailyMissionTasks";
import InviteFriendsSection from "@/components/InviteFriendsSection";
import { showAdgramAd } from "@/lib/showAd";




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
const BLUE = '#6b21a8';



// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const { user, isLoading, isFetching, dataUpdatedAt } = useAuth();
  const { isAdmin } = useAdmin();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();

  const [isConverting, setIsConverting] = useState(false);
  const [isClaimingStreak, setIsClaimingStreak] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(false);
  const [timeUntilNextClaim, setTimeUntilNextClaim] = useState<string>("");

  const [promoPopupOpen, setPromoPopupOpen] = useState(false);
  const [boosterPopupOpen, setBoosterPopupOpen] = useState(false);



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
  // available for these existing reward contexts; the main ad-watching card
  // now lives on the Mission page.
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
      showNotification('Mystery Gift reward added to your Gold balance.', 'success');
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
            <div className="w-2 h-2 rounded-full bg-[#6b21a8] animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#6b21a8] animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#6b21a8] animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <div className="text-foreground font-medium">{t('loading')}</div>
        </div>
      </div>
    );
  }





  // Mutation handlers for Daily Tasks
  // Legacy daily mission handlers removed





  return (
    <Layout>

      <main className="max-w-md mx-auto px-4 text-white flex flex-col" style={{ paddingTop: 8, background: '#090909' }}>

        {/* Promo Code */}
        <section style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 0, paddingLeft: 4 }}>
            Promo Code
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 0, marginBottom: 8, paddingLeft: 4 }}>
            Enter promo code and get rewards.
          </div>
          <PromoCodeInput />
        </section>

        {/* Daily Task: Check-In, Mystery Gift, and daily missions */}
        <style>{`@keyframes spin-hdc { to { transform: rotate(360deg); } }`}</style>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 0, paddingLeft: 4 }}>
            Daily Task
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 0, marginBottom: 8, paddingLeft: 4 }}>
            Complete daily task and get rewards
          </div>

          <div style={{ background: '#252525', borderRadius: 14, overflow: 'hidden' }}>
            {/* Daily Check-In */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
              <img
                src="/assets/check-in.png"
                alt="Daily Check-In"
                style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Check-In</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 7 }}>
                  <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 20, height: 20, objectFit: 'contain' }} />
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>
                    {Number(checkinStatus?.reward ?? CHECKIN_REWARDS[checkinStatus?.dayIndex ?? 0] ?? CHECKIN_REWARDS[0]).toLocaleString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setCheckinSheetOpen(true)}
                disabled={checkinStatus?.alreadyClaimedToday}
                style={{
                  background: checkinStatus?.alreadyClaimedToday ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3d1580, #6b21a8)',
                  color: checkinStatus?.alreadyClaimedToday ? 'rgba(255,255,255,0.3)' : '#fff',
                  border: 'none',
                  width: 92, height: 38, boxSizing: 'border-box' as const, borderRadius: 12, padding: 0, fontSize: 12, fontWeight: 800,
                  cursor: checkinStatus?.alreadyClaimedToday ? 'not-allowed' : 'pointer',
                  flexShrink: 0, letterSpacing: '0.03em', whiteSpace: 'nowrap',
                  boxShadow: checkinStatus?.alreadyClaimedToday ? 'none' : '0 2px 12px rgba(61,21,128,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}
                className="active:scale-95 transition-transform"
              >
                {checkinStatus?.alreadyClaimedToday ? 'DONE' : 'CLAIM'}
              </button>
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />

            {/* Mystery Gift */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
              <img
                src="/assets/mystery-box.png"
                alt="Mystery Gift"
                style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Mystery Gift</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 7 }}>
                  <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 20, height: 20, objectFit: 'contain' }} />
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>
                    1–500
                  </span>
                </div>
              </div>
              <button
                onClick={handleMysteryOpen}
                disabled={mysteryOpened || mysteryAdLoading}
                style={{
                  background: mysteryOpened ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3d1580, #6b21a8)',
                  color: mysteryOpened ? 'rgba(255,255,255,0.3)' : '#fff',
                  border: 'none',
                  width: 92, height: 38, boxSizing: 'border-box' as const, borderRadius: 12, padding: 0, fontSize: 12, fontWeight: 800,
                  cursor: (mysteryOpened || mysteryAdLoading) ? 'not-allowed' : 'pointer', flexShrink: 0,
                  boxShadow: mysteryOpened ? 'none' : '0 2px 12px rgba(61,21,128,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, letterSpacing: '0.03em',
                }}
                className="active:scale-95 transition-transform"
              >
                {mysteryAdLoading ? (
                  <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin-hdc 0.7s linear infinite' }} />
                ) : mysteryOpened ? 'DONE' : 'OPEN'}
              </button>
            </div>

            {/* Check for Updates and Share With Friends stay inside Daily Task */}
            <DailyMissionTasks />
          </div>

        </div>

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

        <InviteFriendsSection />

        {/* Bottom Spacer for floating nav */}
        <div style={{ height: 80, flexShrink: 0 }} />
      </main>

    </Layout>
  );
}
