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
  const [verificationMessage, setVerificationMessage] = useState('');
  const { data, isLoading, isError, refetch, isFetching, isFetchedAfterMount } = useQuery<JoinStatusResponse>({
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

  if (!user) return null;

  // Cached React Query data must never grant access while the current launch or
  // a Telegram resume is being checked. Keep the app covered until the server
  // returns a fresh result; this removes the 1–3 second access window for users
  // who are not members without flashing the join sheet for verified users.
  if (!isFetchedAfterMount || isLoading || isFetching || isError || !data) {
    return <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(10,10,10,0.12)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)', pointerEvents: 'auto' }} />;
  }

  if (data.required === false || data.verified) return null;

  const resources = data.resources ?? [];
  const hasUnjoinedResource = resources.some((resource) => !resource.joined);
  const handleVerify = () => {
    if (hasUnjoinedResource) {
      setVerificationMessage('Please join the channel and group first, then tap Verify.');
      return;
    }
    setVerificationMessage('');
    void refetch();
  };

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
      <div style={{ position: 'relative', width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto', textAlign: 'center', color: '#fff', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.06)', borderBottom: 0, borderRadius: '20px 20px 0 0', padding: '0 16px max(32px, calc(env(safe-area-inset-bottom, 0px) + 16px))', boxSizing: 'border-box' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 32, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '12px auto 20px' }} />
        <div id="telegram-join-title" style={{ marginBottom: 20, color: '#fff', fontSize: 18, fontWeight: 800 }}>
          Join to Continue
        </div>

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

        {verificationMessage && (
          <div role="alert" style={{ margin: '-4px 0 14px', padding: '10px 12px', borderRadius: 12, background: 'rgba(248,113,113,0.12)', color: '#fca5a5', fontSize: 12, fontWeight: 700 }}>
            {verificationMessage}
          </div>
        )}

        <button
          type="button"
          onClick={handleVerify}
          disabled={isLoading || isFetching}
          style={{
            border: 'none',
            width: '100%',
            borderRadius: 16,
            background: 'linear-gradient(135deg,#2563eb,#3b82f6)',
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
  );
}
