// Shared Adsgram ad helpers.
// Window.Adsgram is declared in AdWatchingSection.tsx (same bundle) — no duplicate here.
// Block ids are NO LONGER hardcoded: callers pass the env-based values from
// /api/config/app (ADSGRAM_REWARD_BLOCK_ID / ADSGRAM_CHECKIN_BLOCK_ID /
// ADSGRAM_MYSTERY_BLOCK_ID). When a block id is empty/missing the ad is
// skipped gracefully.

/**
 * Show a rewarded Adsgram ad (used for daily check-in, mystery gift, etc.).
 * Resolves when the ad completes successfully; rejects if the user closes early
 * or the SDK is unavailable.
 */
export function showAdgramAd(blockId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!blockId) {
      reject(new Error("Adsgram block id not configured"));
      return;
    }

    const startedAt = Date.now();
    const tryShow = () => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId })
          .show()
          .then(() => resolve())
          .catch((err: any) => reject(err));
        return;
      }
      if (Date.now() - startedAt >= 10_000) {
        reject(new Error("Adsgram SDK not available"));
        return;
      }
      window.setTimeout(tryShow, 200);
    };
    tryShow();
  });
}

/**
 * Generic rewarded interstitial alias used by the Games page.
 * Delegates to the same Adsgram rewarded flow as showAdgramAd.
 */
export function showRewardedInterstitial(blockId?: string): Promise<void> {
  const id = blockId || import.meta.env.VITE_ADSGRAM_REWARD_BLOCK_ID || '';
  if (!id) return Promise.resolve();
  return showAdgramAd(id);
}

/**
 * Show the first-open acquisition interstitial (non-rewarded).
 * Always resolves — errors are swallowed silently so they never block app load.
 * The block id is env-based (ADSGRAM_POPUP_BLOCK_ID via /api/config/app) —
 * passed in by the caller; never hardcoded.
 */
export function showAdsgramFirstOpenAd(blockId: string): Promise<void> {
  return new Promise((resolve) => {
    if (!blockId || !window.Adsgram) {
      resolve();
      return;
    }
    window.Adsgram.init({ blockId })
      .show()
      .then(() => resolve())
      .catch(() => resolve());
  });
}
