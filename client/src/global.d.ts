// Central Window augmentation for the VUUUG client.
// Previously each .tsx file declared its own `declare global { interface Window ... }`
// block, which broke the Vite production build (vite:define / esbuild transforms
// the module using a plain JS loader and chokes on TS `declare global` syntax).
// Moving all Window type augmentations into a single .d.ts file keeps the build
// clean and keeps every declaration in one place.
// All ad show functions are env-based — ids are resolved from /api/config/app
// (AdsGram block ids, VITE_MONETAG_ZONE_ID etc.), never hardcoded here.

export {};

declare global {
  // iOS long-press preview suppression (used by main.tsx anti-leak code)
  interface CSSStyleDeclaration {
    webkitTouchCallout?: string;
    webkitUserSelect?: string;
  }

  interface Window {
    // ── AdsGram SDK ────────────────────────────────────────────────────
    // userId is an optional param used by some block IDs (e.g. missions)
    Adsgram?: {
      init: (params: { blockId: string; debug?: boolean; userId?: string }) => {
        show: () => Promise<{ done?: boolean; error?: boolean; state?: string; description?: string } | void>;
        destroy: () => void;
      };
    };

    // ── Monetag Rewarded Interstitial ──────────────────────────────────
    // Dynamic show fn — zone id is env-based (VITE_MONETAG_ZONE_ID = 11123429),
    // so the fn name `show_<zone>` is resolved at runtime, never hardcoded.
    show_11123429?: () => Promise<unknown>;

    // ── GigaPub ────────────────────────────────────────────────────────
    showGiga?: () => Promise<unknown> | unknown;

    // ── Cloudflare Turnstile ───────────────────────────────────────────
    turnstile?: {
      render?: (container: string | HTMLElement, options?: Record<string, any>) => string;
      remove?: (widgetId: string) => void;
      reset?: (widgetId: string) => void;
    };

    // ── USL Ads / TowerAds SDK ─────────────────────────────────────────
    AdsManager?: any;
  }
}
