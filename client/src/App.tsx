import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import AppNotification from "@/components/AppNotification";
import TelegramJoinGate from "@/components/TelegramJoinGate";
import { useEffect, lazy, Suspense, useState, memo, useCallback, useRef } from "react";
import { setupDeviceTracking } from "@/lib/deviceId";
import BanScreen from "@/components/BanScreen";
import CountryBlockedScreen from "@/components/CountryBlockedScreen";
import SeasonEndOverlay from "@/components/SeasonEndOverlay";
import { SeasonEndContext } from "@/lib/SeasonEndContext";
import { useAdmin } from "@/hooks/useAdmin";
import BottomNav from "@/components/BottomNav";

import { LanguageProvider } from "@/hooks/useLanguage";
import { Loader2 } from "lucide-react";

// Eagerly import frequently-visited pages — no Suspense flash on navigation
import Mission from "@/pages/Mission";
import Leaderboard from "@/pages/Leaderboard";
import CreateTask from "@/pages/CreateTask";
import Affiliates from "@/pages/Affiliates";
import Account from "@/pages/Account";
import Ads from "@/pages/Ads";

// Lazy-load heavy/rare pages only
const Admin = lazy(() => import("@/pages/Admin"));
const CountryControls = lazy(() => import("@/pages/CountryControls"));
const AmbassadorPage = lazy(() => import("@/pages/Ambassador"));
const NotFound = lazy(() => import("@/pages/not-found"));
const LOGO_SRC = '/app-logo.jpg';
function LoadingFallback() {
  return (
    <div className="fixed inset-0 overflow-hidden" style={{
      background: '#000000', zIndex: 9999,
      pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <img src={LOGO_SRC} alt="Grab Penny" style={{
        width: 92, height: 92, borderRadius: '50%', objectFit: 'cover',
        display: 'block', border: '2px solid rgba(255,255,255,0.12)',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 18, color: '#ffffff' }}>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Loading</span>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/" component={Mission} />
        <Route path="/mission" component={Mission} />
        <Route path="/ads" component={Ads} />
        <Route path="/game" component={Mission} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/country-controls" component={CountryControls} />
        <Route path="/leaderboard" component={Leaderboard} />
        <Route path="/ambassador" component={AmbassadorPage} />
        <Route path="/tasks/create" component={CreateTask} />
        {/* Primary navigation destinations */}
        <Route path="/account" component={Account} />
        <Route path="/affiliates" component={Affiliates} />
        <Route path="/machine" component={Mission} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function DeepLinkRedirector() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const param = localStorage.getItem("tg_start_param") || "";
    if (!param) return;
    if (param === "page_withdraw") {
      localStorage.removeItem("tg_start_param");
      setLocation("/ads");
    } else if (param === "page_referral") {
      localStorage.removeItem("tg_start_param");
      setLocation("/affiliates");
    }
  }, [setLocation]);
  return null;
}

function AppContent() {
  const [showSeasonEnd, setShowSeasonEnd] = useState(false);
  const [seasonLockActive, setSeasonLockActive] = useState(false);
  const { isAdmin } = useAdmin();
  const adsgramOpenShown = useRef(false);
  const isDevMode = import.meta.env.DEV || import.meta.env.MODE === 'development';

  // Keep the environment-configured AdsGram startup placement available for
  // later use. Its reward card is intentionally hidden elsewhere until approval.
  const { data: appConfig } = useQuery<any>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (isDevMode) return;
    if (adsgramOpenShown.current) return;
    adsgramOpenShown.current = true;
    const blockId = appConfig?.adsgramPopupBlockId;
    if (!blockId) return;

    const t = setTimeout(() => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId }).show().catch(() => {});
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [isDevMode, appConfig?.adsgramPopupBlockId]);

  // Use React Query so app-settings is deduplicated with every other component
  // fetching the same key, and the 10 s interval is replaced by a 30 s refetch
  // that doesn't cause top-level re-renders unless the data actually changes.
  const { data: appSettingsData } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (appSettingsData === undefined) return;
    if (appSettingsData?.seasonBroadcastActive) {
      setSeasonLockActive(true);
      setShowSeasonEnd(true);
    } else {
      setSeasonLockActive(false);
      localStorage.removeItem("season_end_seen");
    }
  }, [appSettingsData?.seasonBroadcastActive]);

  const handleCloseSeasonEnd = () => {
    if (!seasonLockActive) {
      localStorage.setItem("season_end_seen", "true");
      setShowSeasonEnd(false);
    }
  };

  const shouldShowSeasonEnd = showSeasonEnd && !isAdmin;

  return (
    <SeasonEndContext.Provider value={{ showSeasonEnd: shouldShowSeasonEnd }}>
      <AppNotification />
      <DeepLinkRedirector />
      {shouldShowSeasonEnd && <SeasonEndOverlay onClose={handleCloseSeasonEnd} isLocked={seasonLockActive} />}
      <Router />
      <TelegramJoinGate />
    </SeasonEndContext.Provider>
  );
}

function App() {
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string>();
  const [isCountryBlocked, setIsCountryBlocked] = useState(false);
  const [userCountryCode, setUserCountryCode] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [isCheckingCountry, setIsCheckingCountry] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(true);

  const isDevMode = import.meta.env.DEV || import.meta.env.MODE === 'development';

  const checkCountry = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) {
        headers['x-telegram-data'] = tg.initData;
      }
      
      const cachedUser = localStorage.getItem("tg_user");
      if (cachedUser) {
        try {
          const user = JSON.parse(cachedUser);
          headers['x-user-id'] = user.id.toString();
        } catch {}
      }
      
      const response = await fetch('/api/check-country', { 
        cache: 'no-store',
        headers
      });
      const data = await response.json();
      
      if (data.country) {
        setUserCountryCode(data.country.toUpperCase());
      }
      
      if (data.blocked) {
        setIsCountryBlocked(true);
      } else {
        setIsCountryBlocked(false);
      }
    } catch (err) {
      console.error("Country check error:", err);
    } finally {
      setIsCheckingCountry(false);
    }
  }, []);

  useEffect(() => {
    checkCountry();
  }, [checkCountry]);

  useEffect(() => {
    const handleCountryBlockChange = (event: CustomEvent) => {
      const { action, countryCode } = event.detail;
      
      if (userCountryCode && countryCode === userCountryCode) {
        if (action === 'blocked') {
          setIsCountryBlocked(true);
        } else if (action === 'unblocked') {
          setIsCountryBlocked(false);
        }
      }
    };
    
    window.addEventListener('countryBlockChanged', handleCountryBlockChange as EventListener);
    
    return () => {
      window.removeEventListener('countryBlockChanged', handleCountryBlockChange as EventListener);
    };
  }, [userCountryCode]);

  // Check ban status after auth completes
  const checkBanStatus = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) {
        headers['x-telegram-data'] = tg.initData;
      }

      const response = await fetch('/api/check-membership', {
        cache: 'no-store',
        headers,
      });
      const data = await response.json();

      if (data.banned) {
        setIsBanned(true);
        setBanReason(data.reason);
      }
    } catch (err) {
      console.error("Ban check error:", err);
    }
  }, []);

  useEffect(() => {
    // Don't wait for country check — run auth immediately in parallel
    if (isCountryBlocked) {
      return;
    }

    if (isDevMode) {
      console.log('Development mode: Skipping Telegram authentication');
      setTelegramId('dev-user-123');
      setIsAuthenticating(false);
      // Still check ban status in dev mode
      checkBanStatus();
      return;
    }
    
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      
      if (tg.initDataUnsafe?.user) {
        localStorage.setItem("tg_user", JSON.stringify(tg.initDataUnsafe.user));
        setTelegramId(tg.initDataUnsafe.user.id.toString());
      }
      
      if (tg.initDataUnsafe?.start_param) {
        localStorage.setItem("tg_start_param", tg.initDataUnsafe.start_param);
      }
      
      const { deviceId, fingerprint } = setupDeviceTracking();
      
      const headers: Record<string, string> = { 
        "Content-Type": "application/json",
        "x-device-id": deviceId,
        "x-device-fingerprint": JSON.stringify(fingerprint)
      };
      let body: any = {};
      let userTelegramId: string | null = null;
      
      const startParam = tg.initDataUnsafe?.start_param || localStorage.getItem("tg_start_param");
      
      if (tg.initData) {
        body = { initData: tg.initData };
        if (startParam) {
          body.startParam = startParam;
        }
        if (tg.initDataUnsafe?.user?.id) {
          userTelegramId = tg.initDataUnsafe.user.id.toString();
        }
      } else {
        const cachedUser = localStorage.getItem("tg_user");
        if (cachedUser) {
          try {
            const user = JSON.parse(cachedUser);
            headers["x-user-id"] = user.id.toString();
            userTelegramId = user.id.toString();
            if (startParam) {
              body.startParam = startParam;
            }
          } catch {}
        }
      }
      
      fetch("/api/auth/telegram", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
        .then(res => res.json())
        .then(data => {
          if (data.referralProcessed) {
            localStorage.removeItem("tg_start_param");
          }
          if (data.banned) {
            setIsBanned(true);
            setBanReason(data.reason);
            setIsAuthenticating(false);
          } else if (userTelegramId) {
            setTelegramId(userTelegramId);
            setIsAuthenticating(false);
            // Now check ban status
            checkBanStatus();
          } else {
            setIsAuthenticating(false);
          }
        })
        .catch(() => {
          setIsAuthenticating(false);
        });
    } else {
      setIsAuthenticating(false);
    }
  }, [isDevMode, isCountryBlocked, checkBanStatus]);

  if (isBanned) {
    return <BanScreen reason={banReason} />;
  }

  if (isAuthenticating) {
    return <LoadingFallback />;
  }

  if (isCountryBlocked) {
    return <CountryBlockedScreen />;
  }

  if (!telegramId && !isDevMode) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-8 rounded-full border-2 border-white/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white mb-4 tracking-tight">Open in Telegram</h1>
          <p className="text-white/60 text-base leading-relaxed">
            Please open this app from Telegram to continue.
          </p>
        </div>
      </div>
    );
  }

  const manifestUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/tonconnect-manifest.json`
    : 'https://paidadz.xyz/tonconnect-manifest.json';

  // Detect if running inside Telegram Mini App
  const isTelegramEnv = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp?.initData;

  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      actionsConfiguration={{
        // In Telegram Mini App, tell TonKeeper to return via tgback (Telegram deep link)
        returnStrategy: (isTelegramEnv ? 'tgback' : 'back') as any,
        twaReturnUrl: 'back' as any,
      }}
      uiPreferences={{
        theme: 'DARK' as any,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <TooltipProvider>
            <AppContent />
          </TooltipProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </TonConnectUIProvider>
  );
}

export default App;
