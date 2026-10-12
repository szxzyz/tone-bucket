export interface AdsgramShowResult {
  success: boolean;
  unavailable: boolean;
}

/**
 * Show the configured AdsGram rewarded placement and resolve only when its SDK
 * reports a completed view. Shared by Watch Ads and gated mining claims.
 */
export function showAdsgramRewardAd(blockId: string): Promise<AdsgramShowResult> {
  return new Promise((resolve) => {
    if (!blockId) {
      resolve({ success: false, unavailable: true });
      return;
    }

    // AdsGram loads asynchronously in index.html; tolerate a slow SDK load.
    const startedAt = Date.now();
    const tryShow = () => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId })
          .show()
          .then((result: any) => resolve({
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
}
