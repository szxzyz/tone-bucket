import { useState, useRef, useEffect, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FiShield, FiZap } from "react-icons/fi";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import { useLanguage } from "@/hooks/useLanguage";
import { useAdFlow } from "@/hooks/useAdFlow";
import { cancelRegisteredAdSession, postWithAdVerification } from "@/lib/adRewardClaim";

interface AdWatchingSectionProps {
  user: any;
  hideTitle?: boolean;
}

// Provider cards are controlled by Admin settings and only render when the
// corresponding provider is configured. This keeps the UI in sync with the
// runtime ad flow instead of showing cards that can never open an ad.
const AD_CARDS = [
  { id: 1, adType: "adsgram", title: "AdsGram", accentColor: "#2563eb", image: "/adsgram-logo.jpg" },
  { id: 2, adType: "monetag", title: "MonetaG", accentColor: "#3b82f6", image: "/monetag-logo.jpg" },
  { id: 3, adType: "gigapub", title: "Gigapub", accentColor: "#3b82f6", image: "/gigapub-logo.jpg" },
  { id: 4, adType: "uslads",  title: "USL Ads", accentColor: "#3b82f6", image: "/usl-logo.jpg" },
];

function AdWatchingSection({ user, hideTitle }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession } = useAdSession();
  const { t } = useLanguage();
  const { showMonetagAd, showGigaPubAd, showUSLAd } = useAdFlow();

  const { data: appConfig } = useQuery<any>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
  });

  const [activeIndex,    setActiveIndex]    = useState(0);
  const [isShowingAds,   setIsShowingAds]   = useState(false);
  const [currentAdStep,  setCurrentAdStep]  = useState<"idle" | "loading" | "verifying">("idle");

  const sessionRewardedRef = useRef(false);
  const currentAdTypeRef   = useRef<string>("adsgram");

  const { data: appSettings } = useQuery({
    queryKey: ["/api/app-settings"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/app-settings");
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const watchAdMutation = useMutation({
    mutationFn: async (payload: {
      adType: string; sessionId: string;
      backgroundDuration: number; backgroundEntered: boolean; sessionStart: number;
    }) => {
      return postWithAdVerification("/api/ads/watch", payload);
    },
    onSuccess: (data: any) => {
      const rewardGems = data?.rewardGems || 0;

      queryClient.setQueryData(["/api/auth/user"], (old: any) => {
        if (!old) return old;
        const adType = currentAdTypeRef.current;
        const updates: any = {
          balance: data?.newBalance !== undefined ? String(data.newBalance) : old.balance,
        };
        if      (adType === "adsgram") updates.adsWatchedToday        = data?.adType === "adsgram" && data?.adTypeWatchedToday !== undefined ? data.adTypeWatchedToday : (old.adsWatchedToday || 0) + 1;
        else if (adType === "monetag") updates.monetagAdsWatchedToday = data?.adType === "monetag" && data?.adTypeWatchedToday !== undefined ? data.adTypeWatchedToday : (old.monetagAdsWatchedToday || 0) + 1;
        else if (adType === "gigapub") updates.gigapubAdsWatchedToday = data?.adType === "gigapub" && data?.adTypeWatchedToday !== undefined ? data.adTypeWatchedToday : (old.gigapubAdsWatchedToday || 0) + 1;
        else if (adType === "uslads")  updates.usladsAdsWatchedToday  = data?.adType === "uslads" && data?.adTypeWatchedToday !== undefined ? data.adTypeWatchedToday : (old.usladsAdsWatchedToday || 0) + 1;
        return { ...old, ...updates };
      });

      // Show rich notification with icons
      showNotification(
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <img src="/assets/gems-icon.svg" alt="GEM" className="w-4 h-4 object-contain" />
            <span className="font-bold text-yellow-500">{rewardGems}</span>
          </div>
        </div> as any,
        "success"
      );

      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
    },
    onError: (error: any) => {
      sessionRewardedRef.current = false;
      showNotification(error.message || "Failed to claim reward", "error");
    },
  });

  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise((resolve) => {
      const blockId = appConfig?.adsgramRewardBlockId || import.meta.env.VITE_ADSGRAM_BLOCK_ID || '';
      if (!blockId) {
        resolve({ success: false, unavailable: true });
        return;
      }

      // AdsGram loads asynchronously in index.html. Wait briefly for the SDK
      // instead of treating a slow script load as an empty ad inventory.
      const startedAt = Date.now();
      const tryShow = () => {
        if (window.Adsgram) {
          window.Adsgram.init({ blockId })
            .show()
            .then((result: any) => resolve({
              // A resolved AdsGram rewarded promise means the ad was completed.
              // Keep an explicit guard for SDK versions that resolve with an
              // unfinished or error payload instead of rejecting.
              success: result?.done !== false && result?.error !== true,
              unavailable: false,
            }))
            .catch(() => resolve({ success: false, unavailable: false }));
          return;
        }
        if (Date.now() - startedAt >= 10_000) {
          resolve({ success: false, unavailable: true });
          return;
        }
        window.setTimeout(tryShow, 200);
      };
      tryShow();
    });

  const visibleCards = appSettings === undefined || appConfig === undefined
    ? []
    : AD_CARDS.filter((card) => {
        const enabled = appSettings?.[`${card.adType}Enabled`] !== false;
        if (!enabled) return false;
        if (card.adType === 'adsgram') return Boolean(appConfig?.adsgramRewardBlockId || import.meta.env.VITE_ADSGRAM_BLOCK_ID);
        if (card.adType === 'monetag') return Boolean(appConfig?.monetagZoneId || import.meta.env.VITE_MONETAG_ZONE_ID || import.meta.env.MONETAG_ZONE_ID);
        // Keep these provider cards visible even before credentials are added,
        // so users can see all available ad networks. The action remains
        // disabled until the provider is configured.
        if (card.adType === 'gigapub' || card.adType === 'uslads') return true;
        return false;
      });

  const isProviderConfigured = (adType: string) => {
    if (adType === 'gigapub') return Boolean(appConfig?.gigapubScriptId || import.meta.env.VITE_GIGAPUB_SCRIPT_ID || '5883');
    // Keep the USL card actionable so a missing secret never appears as a
    // misleading "SETUP NEEDED" state. The SDK call reports a clear error if
    // the deployment has not supplied the real TowerAds API key yet.
    if (adType === 'uslads') return Boolean(
      appConfig?.uslAdsPlacementId || import.meta.env.VITE_USL_ADS_PLACEMENT_ID || 'plc_992db36dbed33f7c',
    );
    return true;
  };

  useEffect(() => {
    if (visibleCards.length > 0 && activeIndex >= visibleCards.length) {
      setActiveIndex(0);
    }
  }, [visibleCards.length, activeIndex]);

  const runAdFlowForCard = async (cardId: number) => {
    if (isShowingAds) return;
    const card = visibleCards.find(c => c.id === cardId);
    if (!card) {
      showNotification("This ad provider is not available right now", "error");
      return;
    }
    setIsShowingAds(true);
    sessionRewardedRef.current = false;
    currentAdTypeRef.current = card.adType;

    const sessionId    = startSession();
    let providerCompleted = false;
    try {
      setCurrentAdStep("loading");
      const regRes = await apiRequest("POST", "/api/ads/register-session", {
        sessionId,
        adType: card.adType,
        context: "ads_watch",
      });
      if (!regRes.ok) {
        cancelSession();
        showNotification("Something went wrong", "error");
        return;
      }
      let result: { success: boolean; unavailable: boolean };

      if (card.adType === "adsgram") {
        result = await showAdsgramAd();
      } else if (card.adType === "monetag") {
        const r = await showMonetagAd(sessionId, "ads_watch");
        result  = { success: r.success, unavailable: r.unavailable };
      } else if (card.adType === "gigapub") {
        result = await showGigaPubAd();
      } else if (card.adType === "uslads") {
        result = await showUSLAd();
      } else {
        result = { success: false, unavailable: true };
      }

      if (result.unavailable) {
        await cancelRegisteredAdSession(sessionId);
        cancelSession();
        showNotification("Ads not available", "error");
        return;
      }
      if (!result.success) {
        await cancelRegisteredAdSession(sessionId);
        cancelSession();
        showNotification(card.adType === "uslads"
          ? "USL Ads API key is missing. Add VITE_USL_ADS_API_KEY in deployment settings."
          : "Please watch the ad completely to claim your reward.", "error");
        return;
      }
      providerCompleted = true;

      // The provider's server callback is the verification gate. No UI state
      // or user action about minimizing/backgrounding is required.
      setCurrentAdStep("verifying");

      const session = endSession();
      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;
        await watchAdMutation.mutateAsync({
          adType:             card.adType,
          sessionId:          session.sessionId,
          backgroundDuration: session.backgroundDuration,
          backgroundEntered:  session.backgroundEntered,
          sessionStart:       session.sessionStart,
        });
      }
    } catch {
      if (!providerCompleted) await cancelRegisteredAdSession(sessionId);
      cancelSession();
    } finally {
      setCurrentAdStep("idle");
      setIsShowingAds(false);
    }
  };

  const handleStartEarning = (cardId: number) => {
    const card      = visibleCards.find(c => c.id === cardId);
    if (!card) return;
    const cardIndex = visibleCards.indexOf(card);
    if (isShowingAds || isCardLimitReached(card.adType)) return;
    if (cardIndex !== activeIndex) { setActiveIndex(cardIndex); return; }
    runAdFlowForCard(cardId);
  };

  const getCardWatched = (adType: string): number => {
    if (adType === "adsgram") return user?.adsWatchedToday || 0;
    if (adType === "monetag") return user?.monetagAdsWatchedToday || 0;
    if (adType === "gigapub") return user?.gigapubAdsWatchedToday || 0;
    if (adType === "uslads")  return user?.usladsAdsWatchedToday  || 0;
    return 0;
  };

  const getCardLimit = (adType: string): number => {
    if (adType === "adsgram") return appSettings?.adsgramAdLimit ?? appSettings?.dailyAdLimit ?? 10;
    if (adType === "monetag") return appSettings?.monetagAdLimit ?? 10;
    if (adType === "gigapub") return appSettings?.gigapubAdLimit ?? 10;
    if (adType === "uslads")  return appSettings?.usladsAdLimit  ?? 10;
    return 10;
  };

	  const getCardReward = (adType: string): number => {
	    if (adType === "adsgram") return appSettings?.adsgramRewardPerAd ?? appSettings?.rewardPerAd ?? 50;
	    if (adType === "monetag") return appSettings?.monetagRewardPerAd ?? 30;
	    if (adType === "gigapub") return appSettings?.gigapubRewardPerAd ?? 30;
	    if (adType === "uslads")  return appSettings?.usladsRewardPerAd  ?? 30;
	    return 30;
	  };

  const isCardLimitReached = (adType: string) =>
    getCardWatched(adType) >= getCardLimit(adType);

  return (
    <>
      <div data-ad-watching-section className={hideTitle ? "" : "mb-4"}>
        {!hideTitle && (
          <div className="mb-3 text-left">
            <h2 className="text-[15px] font-extrabold text-white tracking-widest uppercase mb-0.5">
              Watch Ads
            </h2>
          </div>
        )}

        <div className="select-none" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleCards.map((card, index) => {
            const watched      = getCardWatched(card.adType);
            const limit        = getCardLimit(card.adType);
	            const reward       = getCardReward(card.adType);
		            const limitReached = isCardLimitReached(card.adType);
            const isActive     = index === activeIndex;
            const isLoading    = isShowingAds || watchAdMutation.isPending;

            return (
              <div key={card.id}
                style={{ width: "100%", borderRadius: 16, overflow: "hidden", background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", cursor: "pointer", boxShadow: "0 8px 22px rgba(0,0,0,0.25)" }}
                onClick={() => {
                  if (!isProviderConfigured(card.adType)) return;
                  if (index !== activeIndex) { setActiveIndex(index); return; }
                  handleStartEarning(card.id);
                }}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    overflow: "hidden", background: `${card.accentColor}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {card.image
                      ? <img src={card.image} alt={card.title} loading="lazy" decoding="async"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <FiZap size={20} color={card.accentColor} />
                    }
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.3, marginBottom: 2 }}>
                      Sponsored by
                    </p>
                    <p className="text-white font-bold" style={{ fontSize: 13, lineHeight: 1.2 }}>
                      {card.title}
                    </p>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
                      Ad Limit
                    </p>
                    <span style={{
                      fontSize: 13, fontWeight: 800,
                      color: limitReached ? "rgba(239,68,68,0.85)" : "rgba(255,255,255,0.75)",
                    }}>
                      {watched}
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>/{limit}</span>
                    </span>
                  </div>
                </div>

                <div style={{ padding: "0 12px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                      Reward
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <img src="/assets/gems-icon.svg" alt="GEM" style={{ width: 20, height: 20, objectFit: "contain" }} />
                        <span style={{ fontSize: 16, fontWeight: 900, color: "#ffffff" }}>{reward}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isProviderConfigured(card.adType)) return;
                      if (index !== activeIndex) { setActiveIndex(index); return; }
                      handleStartEarning(card.id);
                    }}
                    disabled={isShowingAds || watchAdMutation.isPending || limitReached || !isProviderConfigured(card.adType)}
                    style={{
                      height: 38, boxSizing: "border-box", padding: "0 16px", borderRadius: 12, minWidth: 92,
                      fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                      letterSpacing: "0.02em", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: limitReached || !isProviderConfigured(card.adType) ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #2563eb, #3b82f6)",
                      color:      limitReached || !isProviderConfigured(card.adType) ? "rgba(255,255,255,0.3)"  : "#fff",
                      opacity: isShowingAds && !isActive ? 0.5 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {isLoading ? (
                      <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} aria-label="Loading" />
                    ) : limitReached ? "LIMIT" : !isProviderConfigured(card.adType) ? "SETUP NEEDED" : "GET GEM"}
                  </button>
                </div>
              </div>
            );
          })}
          {visibleCards.length === 0 && (
            <div style={{ borderRadius: 16, background: "linear-gradient(145deg, #1a1c20 0%, #121317 100%)", boxShadow: "0 8px 22px rgba(0,0,0,0.25)", padding: "20px 16px", textAlign: "center", color: "rgba(255,255,255,0.52)", fontSize: 13, fontWeight: 600 }}>
              Ads are temporarily unavailable. Please try again shortly.
            </div>
          )}
        </div>
      </div>

    </>
  );
}

export default memo(AdWatchingSection);
