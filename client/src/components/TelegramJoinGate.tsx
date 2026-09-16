import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

type TelegramResource = {
  key: 'channel' | 'group';
  title: string;
  link: string;
  joined: boolean;
};

type JoinStatusResponse = {
  required?: boolean;
  verified?: boolean;
  resources?: TelegramResource[];
};

const fetchJoinStatus = async (): Promise<JoinStatusResponse> => {
  const headers: Record<string, string> = {};
  const telegramInitData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : '';
  if (telegramInitData) {
    headers['x-telegram-data'] = telegramInitData;
  }
  // Keep the request useful when Telegram briefly recreates the WebView without
  // exposing initData yet. The session is still sent below and the backend can
  // use it as the authenticated fallback.
  try {
    const cachedUser = localStorage.getItem('tg_user');
    const parsedUser = cachedUser ? JSON.parse(cachedUser) : null;
    if (parsedUser?.id) headers['x-user-id'] = String(parsedUser.id);
  } catch {
    // Ignore malformed local cache; Telegram initData/session remains authoritative.
  }

  const response = await fetch('/api/telegram/join-status', {
    headers,
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Join status request failed: ${response.status}`);
  }

  return response.json();
};

const openTelegramLink = (link: string) => {
  if (!link) return;
  const telegramWebApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  if (telegramWebApp?.openTelegramLink) {
    telegramWebApp.openTelegramLink(link);
    return;
  }
  window.open(link, '_blank', 'noopener,noreferrer');
};

export default function TelegramJoinGate() {
  const { user } = useAuth();
  const [showFallbackGate, setShowFallbackGate] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<JoinStatusResponse>({
    queryKey: ['/api/telegram/join-status', user?.id],
    queryFn: fetchJoinStatus,
    enabled: Boolean(user),
    // App authentication and the persisted session can finish a moment after
    // the cached user renders. Retry that short window instead of opening a
    // false-positive gate with an empty/unauthenticated response.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    // A user can leave from Telegram and return to the mini app before the old
    // 30s poll fires. Keep the fallback poll short, but use the lifecycle
    // listeners below for the immediate check.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  useEffect(() => {
    if (!user) {
      setShowFallbackGate(false);
      return;
    }

    // Do not make users wait for the Telegram API retries before seeing the
    // required action. The gate disappears immediately if the response confirms
    // that joining is not required or the user is already verified.
    const timer = window.setTimeout(() => setShowFallbackGate(true), 350);
    return () => window.clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let refreshTimer: number | undefined;
    const refreshMembership = () => {
      if (document.visibilityState === 'hidden') return;
      window.clearTimeout(refreshTimer);
      // Telegram finishes restoring the WebView a moment after pageshow/focus.
      refreshTimer = window.setTimeout(() => {
        void refetch({ cancelRefetch: false });
      }, 250);
    };

    window.addEventListener('focus', refreshMembership);
    window.addEventListener('pageshow', refreshMembership);
    document.addEventListener('visibilitychange', refreshMembership);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener('focus', refreshMembership);
      window.removeEventListener('pageshow', refreshMembership);
      document.removeEventListener('visibilitychange', refreshMembership);
    };
  }, [user, refetch]);

  // Never render the blocking UI before the server has returned an explicit
  // verification result. This prevents the popup from looking like a splash
  // screen during app startup and avoids gating users on transient failures.
  if (!user || data?.required === false || data?.verified) return null;
  if (!showFallbackGate && (isLoading || isError || !data)) return null;

  const resources = data?.resources ?? [
    { key: 'channel' as const, title: 'Official Channel', link: '', joined: false },
    { key: 'group' as const, title: 'Community group', link: '', joined: false },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="telegram-join-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 430, maxHeight: '82vh', overflowY: 'auto', textAlign: 'center', color: '#fff', background: 'linear-gradient(180deg, #1a1a1e 0%, #111114 100%)', borderRadius: '26px 26px 0 0', border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none', boxShadow: '0 -12px 40px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
        <div style={{ height: 6, width: '100%', background: 'linear-gradient(90deg, #1677ff 0%, #38bdf8 50%, #1677ff 100%)' }} />
        <div style={{ padding: '24px 18px max(22px, calc(env(safe-area-inset-bottom, 0px) + 12px))' }}>
        <h1 id="telegram-join-title" style={{ margin: 0, fontSize: 19, lineHeight: 1.2, fontWeight: 900 }}>
          Join to Continue
        </h1>
        <p style={{ margin: '8px 0 20px', color: 'rgba(255,255,255,0.56)', fontSize: 13, lineHeight: 1.45 }}>
          to access this app please join our official Telegram resources.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {resources.map((resource) => (
            <button
              key={resource.key}
              type="button"
              onClick={() => openTelegramLink(resource.link)}
              disabled={!resource.link}
              aria-label={`Open ${resource.title}`}
              className="w-full flex items-center justify-between active:scale-[0.98] transition-transform"
              style={{
                border: 'none',
                borderRadius: 18,
                background: resource.joined ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.08)',
                color: resource.joined ? '#22c55e' : '#fff',
                padding: '13px 15px',
                fontSize: 14,
                fontWeight: 700,
                textAlign: 'left',
                cursor: resource.link ? 'pointer' : 'default',
                opacity: resource.link ? 1 : 0.55,
              }}
            >
              <span>{resource.title}</span>
              <span aria-hidden="true" style={{ color: resource.joined ? '#22c55e' : 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 800 }}>
                {resource.joined ? 'JOINED' : 'JOIN'}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading || isFetching}
          style={{
            border: 'none',
            width: '100%',
            borderRadius: 16,
            background: '#1677ff',
            color: '#fff',
            padding: '13px 18px',
            fontSize: 15,
            fontWeight: 800,
            cursor: isLoading || isFetching ? 'wait' : 'pointer',
            opacity: isLoading || isFetching ? 0.65 : 1,
          }}
        >
          Verify &amp; enter app
        </button>
        </div>
      </div>
    </div>
  );
}
