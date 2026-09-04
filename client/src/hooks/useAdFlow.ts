import { useState, useCallback, useRef } from 'react';

declare global {
  interface Window {
    show_10013974?: (type?: string) => Promise<void>;
    showGiga?: () => Promise<unknown> | unknown;
    TowerAds: new (config: {
      apiKey: string;
      placementId: string;
      onRewardEarned?: (reward: unknown) => void;
      onError?: (error: unknown) => void;
    }) => { loadAndShow: () => Promise<void> };
  }
}

// Ad SDK credentials — read from the env-based app config
// endpoint (/api/config/app), never hardcoded.
let _appConfigPromise: Promise<any> | null = null;
async function getAppConfig(): Promise<any> {
  if (_appConfigPromise) return _appConfigPromise;
  _appConfigPromise = (async () => {
    try {
      const res = await fetch('/api/config/app', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(`Config request failed: ${res.status}`);
      return await res.json();
    } catch (error) {
      // Do not cache a failed/empty response. A temporary WebView/network
      // failure must not make every later ad attempt look unconfigured.
      console.warn('Ad config request failed; will retry:', error);
      return null;
    }
  })();
  const config = await _appConfigPromise;
  _appConfigPromise = config ? Promise.resolve(config) : null;
  return config || {};
}

const _monetagScriptPromises = new Map<string, Promise<boolean>>();
async function ensureMonetagScript(zoneId: string): Promise<boolean> {
  if (typeof window[`show_${zoneId}` as keyof Window] === 'function') return true;
  const existing = _monetagScriptPromises.get(zoneId);
  if (existing) return existing;

  const promise = new Promise<boolean>((resolve) => {
    const current = Array.from(document.scripts).find((script) => script.dataset.zone === zoneId) as HTMLScriptElement | undefined;
    if (current) {
      current.addEventListener('load', () => resolve(true), { once: true });
      current.addEventListener('error', () => resolve(false), { once: true });
      window.setTimeout(() => resolve(typeof window[`show_${zoneId}` as keyof Window] === 'function'), 8_000);
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = '//libtl.com/sdk.js';
    script.dataset.zone = zoneId;
    script.dataset.sdk = `show_${zoneId}`;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  _monetagScriptPromises.set(zoneId, promise);
  return promise;
}

async function getUslAdsConfig(): Promise<{ apiKey: string; placementId: string }> {
  const cfg = await getAppConfig();
  const apiKey = cfg?.uslAdsApiKey || import.meta.env.VITE_USL_ADS_API_KEY || '';
  const placementId = cfg?.uslAdsPlacementId || import.meta.env.VITE_USL_ADS_PLACEMENT_ID || '';
  return { apiKey, placementId };
}

// GiGaPub dynamic loader
let _gigaPubScriptLoaded = false;
async function ensureGigaPubScript(): Promise<boolean> {
  if (_gigaPubScriptLoaded || typeof window.showGiga === 'function') return true;
  const cfg = await getAppConfig();
  const scriptId = cfg?.gigapubScriptId || import.meta.env.VITE_GIGAPUB_SCRIPT_ID || '';
  if (!scriptId) return false;

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://ad.gigapub.tech/script?id=${scriptId}`;
    script.onload = () => { _gigaPubScriptLoaded = true; resolve(true); };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

interface AdFlowResult {
  success: boolean;
  monetagWatched: boolean;
}

function waitForFn(name: keyof Window, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window[name] === 'function') { resolve(true); return; }
    const start = Date.now();
    const id = setInterval(() => {
      if (typeof window[name] === 'function') { clearInterval(id); resolve(true); }
      else if (Date.now() - start >= timeoutMs) { clearInterval(id); resolve(false); }
    }, 200);
  });
}

export function useAdFlow() {
  const [isShowingAds, setIsShowingAds] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'monetag' | 'complete'>('idle');

  const showMonetagAd = useCallback((): Promise<{ success: boolean; watchedFully: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      // Prefer the server-provided runtime zone id so a deployment does not
      // depend on the client bundle having the build-time env variable.
      const cfg = await getAppConfig();
      const zoneId = cfg?.monetagZoneId || import.meta.env.VITE_MONETAG_ZONE_ID || import.meta.env.MONETAG_ZONE_ID || '';
      const showFn = zoneId ? (`show_${zoneId}` as keyof Window) : null;
      if (zoneId && showFn && typeof window[showFn] !== 'function') {
        await ensureMonetagScript(zoneId);
      }
      const ready = showFn ? await waitForFn(showFn) : false;
      if (!ready) { resolve({ success: false, watchedFully: false, unavailable: true }); return; }

      const providerStartedAt = Date.now();
      let settled = false;
      const settle = (r: { success: boolean; watchedFully: boolean; unavailable: boolean }) => {
        if (settled) return; settled = true; clearTimeout(timer); resolve(r);
      };
      // Hard timeout — if the Monetag SDK never settles (no fill, script error,
      // etc.) the Watch button would spin forever without this guard.
      const timer = setTimeout(() => {
        console.warn('Monetag ad timed out after 30 s');
        settle({ success: false, watchedFully: false, unavailable: true });
      }, 30_000);

      try {
        (window[showFn as keyof Window] as ((t?: string) => Promise<void>))()
          .then(async () => {
            // The backend requires a minimum provider session window. Some
            // Monetag SDK builds resolve before the native overlay has fully
            // settled, so keep the session alive long enough to claim safely.
            const remaining = 3_200 - (Date.now() - providerStartedAt);
            if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
            settle({ success: true, watchedFully: true, unavailable: false });
          })
          .catch((error) => {
            console.error('Monetag ad error:', error);
            const msg = String(error?.message || error || '').toLowerCase();
            const noAds = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable');
            settle({ success: false, watchedFully: false, unavailable: noAds });
          });
      } catch (error) {
        // If show_<zone>() throws synchronously (rather than rejecting a
        // promise), the .then/.catch above never run and settle() would
        // never be called — leaving this ad stuck "loading" forever. Catch
        // it here so a bad SDK call still resolves cleanly.
        console.error('Monetag ad sync error:', error);
        settle({ success: false, watchedFully: false, unavailable: false });
      }
    });
  }, []);

  const showGigaPubAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const scriptReady = await ensureGigaPubScript();
      if (!scriptReady) { resolve({ success: false, unavailable: true }); return; }

      const ready = await waitForFn('showGiga');
      if (!ready) { resolve({ success: false, unavailable: true }); return; }

      let settled = false;
      const settle = (r: { success: boolean; unavailable: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => {
        console.warn('GigaPub ad timed out after 30 s');
        settle({ success: false, unavailable: true });
      }, 30_000);

      try {
        const adResult = window.showGiga?.();
        if (adResult && typeof (adResult as any).then === 'function') {
          (adResult as Promise<unknown>)
            .then(() => {
              console.info('GigaPub ad completed successfully');
              settle({ success: true, unavailable: false });
            })
            .catch((e: any) => {
              console.error('GigaPub ad error:', e);
              const msg = String(e?.message || e?.error || e || '').toLowerCase();
              const noAds = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable') || msg.includes('empty');
              settle({ success: false, unavailable: noAds });
            });
        } else {
          // Some GigaPub builds open the native ad and return void. Keep the
          // session alive beyond the server's minimum duration before claiming.
          window.setTimeout(() => {
            console.info('GigaPub ad launched without a completion promise');
            settle({ success: true, unavailable: false });
          }, 4_000);
        }
      } catch (e) {
        console.error('GigaPub ad sync error:', e);
        settle({ success: false, unavailable: false });
      }
    });
  }, []);

  // ─── USL Ads (TowerAds SDK) ───────────────────────────────────────────────
  // The TowerAds SDK binds callbacks at construction time. Re-using the same
  // instance across multiple ad invocations means the callbacks from the first
  // construction close over that invocation's `settle`/`rewardEarned` — every
  // subsequent invocation's callbacks would silently call the wrong resolver.
  //
  // Fix: route all callbacks through a mutable ref that always points to the
  // *current* invocation's resolver. The instance is still a singleton (to
  // avoid loading the SDK script more than once), but the effective callback
  // target is swapped on every call.
  const uslAdsInstanceRef   = useRef<InstanceType<Window["TowerAds"]> | null>(null);
  const uslCurrentSettleRef = useRef<((r: { success: boolean; unavailable: boolean }) => void) | null>(null);

  const showUSLAd = useCallback((): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise(async (resolve) => {
      const ready = await waitForFn('TowerAds', 10_000);
      if (!ready) { resolve({ success: false, unavailable: true }); return; }

      let settled = false;
      const settle = (result: { success: boolean; unavailable: boolean }) => {
        if (settled) return;
        settled = true;
        uslCurrentSettleRef.current = null; // clear so stale callbacks can't fire twice
        resolve(result);
      };

      // Point the mutable ref at THIS invocation's resolver BEFORE showing the ad.
      uslCurrentSettleRef.current = settle;

      try {
        if (!uslAdsInstanceRef.current) {
          const uslConfig = await getUslAdsConfig();
          uslAdsInstanceRef.current = new window.TowerAds({
            apiKey: uslConfig.apiKey,
            placementId: uslConfig.placementId,
            // All callbacks route through the mutable ref so they always reach
            // the current invocation regardless of how many times the ad runs.
            onRewardEarned: () => {
              console.log("USL Ads: reward earned");
              uslCurrentSettleRef.current?.({ success: true, unavailable: false });
            },
            onError: (error) => {
              console.error("USL Ads error:", error);
              uslCurrentSettleRef.current?.({ success: false, unavailable: false });
            },
          });
        }

        // Hard 30 s timeout — if loadAndShow() never resolves AND onRewardEarned /
        // onError never fire (e.g. the ad is still playing or the SDK is stuck),
        // the Watch button would spin forever without this guard.
        const hardTimer = setTimeout(() => {
          console.warn('USL Ads timed out after 30 s');
          settle({ success: false, unavailable: true });
        }, 30_000);

        uslAdsInstanceRef.current.loadAndShow()
          .then(() => {
            clearTimeout(hardTimer);
            // loadAndShow() resolving does not by itself mean a reward was earned
            // (the user may have closed the ad early) — onRewardEarned is the
            // only source of truth. Give it a brief grace window in case it
            // fires just after the promise settles; if it hasn't fired by then,
            // settle as not rewarded.
            // Some TowerAds builds resolve loadAndShow before dispatching the
            // reward callback. Give that callback enough time to arrive, while
            // still recovering if the SDK silently returns without a reward.
            setTimeout(() => {
              if (!settled) {
                console.warn('USL Ads: loadAndShow resolved but onRewardEarned never fired within grace window — not rewarding.');
              }
              settle({ success: false, unavailable: false });
            }, 2_000);
          })
          .catch((error: any) => {
            clearTimeout(hardTimer);
            console.error("USL Ads loadAndShow error:", error);
            const msg = String(error?.message || error || "").toLowerCase();
            const noAds = msg.includes("no ad") || msg.includes("no fill") || msg.includes("unavailable");
            settle({ success: false, unavailable: noAds });
          });
      } catch (error) {
        console.error("USL Ads init error:", error);
        settle({ success: false, unavailable: true });
      }
    });
  }, []);
  // ──────────────────────────────────────────────────────────────────────────

  const runAdFlow = useCallback(async (): Promise<AdFlowResult> => {
    setIsShowingAds(true);
    try {
      setAdStep('monetag');
      const monetagResult = await showMonetagAd();
      if (monetagResult.unavailable) { setAdStep('idle'); return { success: false, monetagWatched: false }; }
      if (!monetagResult.success) { setAdStep('idle'); return { success: false, monetagWatched: false }; }
      setAdStep('complete');
      return { success: true, monetagWatched: true };
    } finally {
      setIsShowingAds(false);
      setAdStep('idle');
    }
  }, [showMonetagAd]);

  return {
    isShowingAds,
    adStep,
    runAdFlow,
    showMonetagAd,
    showGigaPubAd,
    showUSLAd,
  };
}
