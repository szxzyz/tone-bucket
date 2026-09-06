import { useState, useRef, useEffect, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FiShield, FiZap } from "react-icons/fi";
import { showNotification } from "@/components/AppNotification";
import { useAdSession } from "@/hooks/useAdSession";
import AdFailurePopup from "@/components/AdFailurePopup";
import { useLanguage } from "@/hooks/useLanguage";
import { useAdFlow } from "@/hooks/useAdFlow";

interface AdWatchingSectionProps {
  user: any;
  hideTitle?: boolean;
}

// Provider cards are controlled by Admin settings and only render when the
// corresponding provider is configured. This keeps the UI in sync with the
// runtime ad flow instead of showing cards that can never open an ad.
const AD_CARDS = [
  { id: 1, adType: "adsgram", title: "AdsGram", accentColor: "#3d1580", image: "/adsgram-logo.jpg" },
  { id: 2, adType: "monetag", title: "MonetaG", accentColor: "#6b21a8", image: "/monetag-logo.jpg" },
  { id: 3, adType: "gigapub", title: "Gigapub", accentColor: "#6b21a8", image: "/gigapub-logo.jpg" },
  { id: 4, adType: "uslads",  title: "USL Ads", accentColor: "#6b21a8", image: "/usl-logo.jpg" },
];

function AdWatchingSection({ user, hideTitle }: AdWatchingSectionProps) {
  const queryClient = useQueryClient();
  const { startSession, endSession, cancelSession, waitForForeground, getSessionStart } = useAdSession();
  const { t } = useLanguage();
  const { showMonetagAd, showGigaPubAd, showUSLAd } = useAdFlow();

  const { data: appConfig } = useQuery<any>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
  });

  const [activeIndex,    setActiveIndex]    = useState(0);
  const [isShowingAds,   setIsShowingAds]   = useState(false);
  const [currentAdStep,  setCurrentAdStep]  = useState<"idle" | "loading" | "verifying">("idle");
  const [showFailurePopup, setShowFailurePopup] = useState(false);

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
      const r = await apiRequest("POST", "/api/ads/watch", payload);
      return r.json();
    },
    onSuccess: (data: any) => {
      const rewardGems = data?.rewardGems || 0;

      queryClient.setQueryData(["/api/auth/user"], (old: any) => {
        if (!old) return old;
        const adType = currentAdTypeRef.current;
        const updates: any = {
          balance: data?.newBalance !== undefined ? String(data.newBalance) : old.balance,
        };
        if      (adType === "adsgram") updates.adsWatchedToday        = (old.adsWatchedToday        || 0) + 1;
        else if (adType === "monetag") updates.monetagAdsWatchedToday = (old.monetagAdsWatchedToday || 0) + 1;
        else if (adType === "gigapub") updates.gigapubAdsWatchedToday = (old.gigapubAdsWatchedToday || 0) + 1;
        else if (adType === "uslads")  updates.usladsAdsWatchedToday  = (old.usladsAdsWatchedToday  || 0) + 1;
        return { ...old, ...updates };
      });

      // Show rich notification with icons
      showNotification(
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <img src="/assets/gold-icon.png" alt="Gold" className="w-4 h-4 object-contain" />
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
      if (error.errorType === "insufficient_background") { setShowFailurePopup(true); }
      else showNotification(error.message || "Failed to claim reward", "error");
    },
  });

  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise((resolve) => {
      const blockId = appConfig?.adsgramRewardBlockId || '';
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
            .then(() => resolve({ success: true, unavailable: false }))
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
        if (card.adType === 'adsgram') return Boolean(appConfig?.adsgramRewardBlockId);
        if (card.adType === 'monetag') return Boolean(appConfig?.monetagZoneId || import.meta.env.VITE_MONETAG_ZONE_ID || import.meta.env.MONETAG_ZONE_ID);
        if (card.adType === 'gigapub') return Boolean(appConfig?.gigapubScriptId || import.meta.env.VITE_GIGAPUB_SCRIPT_ID);
        if (card.adType === 'uslads') return Boolean((appConfig?.uslAdsApiKey || import.meta.env.VITE_USL_ADS_API_KEY) && (appConfig?.uslAdsPlacementId || import.meta.env.VITE_USL_ADS_PLACEMENT_ID));
        return false;
      });

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
        const r = await showMonetagAd();
        result  = { success: r.success, unavailable: r.unavailable };
      } else if (card.adType === "gigapub") {
        result = await showGigaPubAd();
      } else if (card.adType === "uslads") {
        result = await showUSLAd();
      } else {
        result = { success: false, unavailable: true };
      }

      if (result.unavailable) { showNotification("Ads not available", "error"); return; }
      if (!result.success) return;

      // AdsGram and Gigapub can move the Mini App behind a native ad overlay.
      // Wait for the user to return before claiming, then keep Gigapub sessions
      // above the server's minimum 3-second provider window.
      if (card.adType === "adsgram" || card.adType === "gigapub") {
        setCurrentAdStep("verifying");
        await waitForForeground();
      }
      if (card.adType === "monetag" || card.adType === "gigapub") {
        const remaining = 3_200 - (Date.now() - getSessionStart());
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }

      const session = endSession();
      if (!sessionRewardedRef.current) {
        sessionRewardedRef.current = true;
        watchAdMutation.mutate({
          adType:             card.adType,
          sessionId:          session.sessionId,
          backgroundDuration: session.backgroundDuration,
          backgroundEntered:  session.backgroundEntered,
          sessionStart:       session.sessionStart,
        });
      }
    } catch {
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
	    if (adType === "adsgram") return appSettings?.adsgramRewardPerAd ?? appSettings?.rewardPerAd ?? 125;
	    if (adType === "monetag") return appSettings?.monetagRewardPerAd ?? 125;
	    if (adType === "gigapub") return appSettings?.gigapubRewardPerAd ?? 125;
	    if (adType === "uslads")  return appSettings?.usladsRewardPerAd  ?? 125;
	    return 125;
	  };

  const isCardLimitReached = (adType: string) =>
    getCardWatched(adType) >= getCardLimit(adType);

  return (
    <>
      <div className={hideTitle ? "" : "mb-4"}>
        {!hideTitle && (
          <div className="mb-3 text-left">
            <h2 className="text-[15px] font-extrabold text-white tracking-widest uppercase mb-0.5">
              Golden Ad
            </h2>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.12em]">
              Watch ads to earn gold and boost your income.
            </p>
          </div>
        )}

        <div className="select-none" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleCards.map((card, index) => {
            const watched      = getCardWatched(card.adType);
            const limit        = getCardLimit(card.adType);
	            const reward       = getCardReward(card.adType);
		            const limitReached = isCardLimitReached(card.adType);
            const isActive     = index === activeIndex;
            const isLoading    = isShowingAds && isActive;

            return (
              <div key={card.id}
                style={{ width: "100%", borderRadius: 18, overflow: "hidden", background: "#171717", cursor: "pointer", border: "none" }}
                onClick={() => {
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
                        <img src="/assets/gold-icon.png" alt="Gold" style={{ width: 20, height: 20, objectFit: "contain" }} />
                        <span style={{ fontSize: 16, fontWeight: 900, color: "#ffffff" }}>{reward}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (index !== activeIndex) { setActiveIndex(index); return; }
                      handleStartEarning(card.id);
                    }}
                    disabled={isShowingAds || limitReached}
                    style={{
                      padding: "9px 16px", borderRadius: 12, minWidth: 92,
                      fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                      letterSpacing: "0.02em", whiteSpace: "nowrap",
                      background: limitReached ? "rgba(255,255,255,0.06)" : "#6b21a8",
                      color:      limitReached ? "rgba(255,255,255,0.3)"  : "#fff",
                      opacity: isShowingAds && !isActive ? 0.5 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {isLoading ? (
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                        {currentAdStep === "verifying"
                          ? <><FiShield size={11} style={{ animation: "pulse 1s infinite" }} />Verifying</>
                          : <><FiZap    size={11} style={{ animation: "spin 0.8s linear infinite" }} />Loading</>
                        }
                      </span>
                    ) : limitReached ? "LIMIT" : "GET GOLD"}
                  </button>
                </div>
              </div>
            );
          })}
          {visibleCards.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-xs text-white/50">
              Ads are temporarily unavailable. Please try again shortly.
            </div>
          )}
        </div>
      </div>

      {showFailurePopup && (
        <AdFailurePopup
          onClose={() => setShowFailurePopup(false)}
          reason="ad_not_counted"
        />
      )}
    </>
  );
}

export default memo(AdWatchingSection);
