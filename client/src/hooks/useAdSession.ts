import { useRef, useCallback } from 'react';

export interface AdSessionResult {
  sessionId: string;
  backgroundDuration: number;
  backgroundEntered: boolean;
  sessionStart: number;
  totalDuration: number;
}

export function useAdSession() {
  const sessionIdRef        = useRef<string>('');
  const sessionStartRef     = useRef<number>(0);
  const backgroundStartRef  = useRef<number | null>(null);
  const backgroundDurRef    = useRef<number>(0);
  const backgroundEnteredRef = useRef<boolean>(false);
  const verifiedHiddenStartRef = useRef<number | null>(null);
  const verifiedHiddenDurationRef = useRef<number>(0);
  const isHiddenRef         = useRef<boolean>(false);
  const listenersRef        = useRef<Array<{ target: Document | Window; type: string; fn: EventListener }>>([]);
  // Telegram WebApp events are registered/removed through a separate API,
  // so we keep their teardown functions in their own ref.
  const tgTeardownRef = useRef<Array<() => void>>([]);

  const startSession = useCallback((): string => {
    const rand = () => Math.random().toString(36).slice(2, 9);
    const uid  = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : rand() + rand();
    const sessionId = `${Date.now()}-${rand()}-${uid}`;

    sessionIdRef.current         = sessionId;
    sessionStartRef.current      = Date.now();
    backgroundStartRef.current   = null;
    backgroundDurRef.current     = 0;
    backgroundEnteredRef.current = false;
    verifiedHiddenStartRef.current = null;
    verifiedHiddenDurationRef.current = 0;
    isHiddenRef.current          = false;

    // Tear down any DOM + Telegram listeners from a previous session
    for (const { target, type, fn } of listenersRef.current) {
      target.removeEventListener(type, fn);
    }
    listenersRef.current = [];
    for (const off of tgTeardownRef.current) off();
    tgTeardownRef.current = [];

    const enterBackground = (qualifyingVisibility = false) => {
      if (qualifyingVisibility) backgroundEnteredRef.current = true;
      if (isHiddenRef.current) return; // already counted
      isHiddenRef.current = true;
      backgroundStartRef.current   = Date.now();
    };

    const exitBackground = () => {
      if (!isHiddenRef.current) return;
      isHiddenRef.current = false;
      if (backgroundStartRef.current !== null) {
        backgroundDurRef.current += Date.now() - backgroundStartRef.current;
        backgroundStartRef.current = null;
      }
    };

    // Different WebViews (Telegram Android/iOS/Desktop, mobile browsers) are
    // inconsistent about which of these fire when the user minimizes the app
    // or switches to another window — listen to all of them so a genuine
    // minimize is reliably detected regardless of platform.
    const onVisibilityChange = () => {
      if (document.hidden) {
        // Blur/deactivation also fire for native ad overlays. Only a real
        // hidden document is accepted as the user's explicit Mini App minimize.
        enterBackground(true);
        if (verifiedHiddenStartRef.current === null) verifiedHiddenStartRef.current = Date.now();
      } else {
        if (verifiedHiddenStartRef.current !== null) {
          verifiedHiddenDurationRef.current = Math.max(
            verifiedHiddenDurationRef.current,
            Date.now() - verifiedHiddenStartRef.current,
          );
          verifiedHiddenStartRef.current = null;
        }
        exitBackground();
      }
    };
    const onBlur   = () => enterBackground();
    // Telegram's native ad overlay can briefly emit focus while the overlay
    // is still open. Only treat focus as a real return when the document is
    // actually visible; otherwise the background timer is cut short and the
    // server may reject a legitimately completed ad.
    const onFocus  = () => { if (!document.hidden) exitBackground(); };
    const onPageHide = () => enterBackground();
    const onPageShow = () => { if (!document.hidden) exitBackground(); };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    listenersRef.current = [
      { target: document, type: 'visibilitychange', fn: onVisibilityChange },
      { target: window,   type: 'blur',              fn: onBlur },
      { target: window,   type: 'focus',             fn: onFocus },
      { target: window,   type: 'pagehide',           fn: onPageHide },
      { target: window,   type: 'pageshow',           fn: onPageShow },
    ];

    // ── Telegram WebApp lifecycle events ───────────────────────────────────
    // Telegram Mini App ad SDKs (Monetag, GigaPub, etc.) typically open a
    // Telegram-native dialog (Stars payment prompt, interstitial, etc.) which
    // deactivates the mini app without necessarily hiding the document.
    // `visibilitychange` / `blur` may not fire in this case, so we also
    // listen to the Telegram-specific events to capture the genuine background.
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.onEvent) {
      tg.onEvent('deactivated', enterBackground);
      tg.onEvent('activated',   exitBackground);
      tgTeardownRef.current = [
        () => tg.offEvent?.('deactivated', enterBackground),
        () => tg.offEvent?.('activated',   exitBackground),
      ];
    }

    return sessionId;
  }, []);

  const teardownListeners = () => {
    for (const { target, type, fn } of listenersRef.current) {
      target.removeEventListener(type, fn);
    }
    listenersRef.current = [];
    // Also remove Telegram WebApp listeners if registered
    for (const off of tgTeardownRef.current) off();
    tgTeardownRef.current = [];
  };

  // Resolves once the app has actually returned to the foreground (i.e. the
  // user has come back from minimizing/switching away). If the app is
  // already foregrounded, resolves immediately. This lets callers avoid
  // firing the reward request while the user is still backgrounded — which
  // would both undercount backgroundDuration and confusingly claim the
  // reward before the user has genuinely "returned".
  // A generous timeout guards against the case where no return event ever
  // fires (e.g. the ad never actually backgrounded the app at all).
  // Also listens to the Telegram WebApp `activated` event because some ad
  // providers (Gigapub, Monetag) open a Telegram-native overlay that fires
  // `deactivated`/`activated` without necessarily triggering DOM events.
  const waitForForeground = useCallback((timeoutMs = 3_000): Promise<void> => {
    return new Promise((resolve) => {
      if (!isHiddenRef.current && !document.hidden) { resolve(); return; }

      let settled = false;
      const tg = (window as any).Telegram?.WebApp;

      const finish = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener('visibilitychange', onReturn);
        window.removeEventListener('focus', onReturn);
        window.removeEventListener('pageshow', onReturn);
        tg?.offEvent?.('activated', onTgActivated);
        clearTimeout(timer);
        resolve();
      };
      const onReturn = () => {
        if (!document.hidden) finish();
      };
      // Telegram WebApp activated fires when the mini app returns to focus
      // after a native overlay (ad dialog, Stars payment, etc.) is dismissed.
      const onTgActivated = () => finish();

      document.addEventListener('visibilitychange', onReturn);
      window.addEventListener('focus', onReturn);
      window.addEventListener('pageshow', onReturn);
      if (tg?.onEvent) tg.onEvent('activated', onTgActivated);
      const timer = setTimeout(finish, timeoutMs);
    });
  }, []);

  const getSessionStart = useCallback(() => sessionStartRef.current, []);

  const endSession = useCallback((): AdSessionResult => {
    if (verifiedHiddenStartRef.current !== null) {
      verifiedHiddenDurationRef.current = Math.max(
        verifiedHiddenDurationRef.current,
        Date.now() - verifiedHiddenStartRef.current,
      );
      verifiedHiddenStartRef.current = null;
    }
    if (backgroundStartRef.current !== null) {
      backgroundDurRef.current += Date.now() - backgroundStartRef.current;
      backgroundStartRef.current = null;
    }
    teardownListeners();
    return {
      sessionId:          sessionIdRef.current,
      backgroundDuration: verifiedHiddenDurationRef.current,
      backgroundEntered:  backgroundEnteredRef.current,
      sessionStart:       sessionStartRef.current,
      totalDuration:      Date.now() - sessionStartRef.current,
    };
  }, []);

  const cancelSession = useCallback(() => {
    teardownListeners();
  }, []);

  return { startSession, endSession, cancelSession, waitForForeground, getSessionStart };
}
