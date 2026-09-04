declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          query_id?: string;
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            is_premium?: boolean;
            photo_url?: string;
          };
          start_param?: string;
          auth_date: number;
          hash: string;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
        openTelegramLink: (url: string) => void;
        BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
        closeConfirmation?: { enable: () => void; disable: () => void };
        isClosingConfirmationEnabled?: boolean;
        HapticFeedback?: {
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          selectionChanged: () => void;
        };
        // Event binding (used by ChannelJoinPopup) + other WebApp members.
        // Typed loosely — Telegram adds many properties at runtime.
        onEvent: (eventType: string, eventHandler: (...args: any[]) => void) => void;
        offEvent: (eventType: string, eventHandler: (...args: any[]) => void) => void;
        [extra: string]: any;
      };
    };
  }
}

export {};