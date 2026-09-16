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
  const { data, isLoading, isError, refetch, isFetching } = useQuery<JoinStatusResponse>({
    queryKey: ['/api/telegram/join-status', user?.id],
    queryFn: fetchJoinStatus,
    enabled: Boolean(user),
    // App authentication and the persisted session can finish a moment after
    // the cached user renders. Retry that short window instead of opening a
    // false-positive gate with an empty/unauthenticated response.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  });

  // Never render the blocking UI before the server has returned an explicit
  // verification result. This prevents the popup from looking like a splash
  // screen during app startup and avoids gating users on transient failures.
  if (!user || isLoading || isError || !data || data.required === false || data.verified) return null;

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
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(0,0,0,0.96)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 320, textAlign: 'center', color: '#fff' }}>
        <h1 id="telegram-join-title" style={{ margin: 0, fontSize: 18, lineHeight: 1.2, fontWeight: 900 }}>
          Welcome to Axionet
        </h1>
        <p style={{ margin: '8px 0 18px', color: 'rgba(255,255,255,0.56)', fontSize: 12, lineHeight: 1.45 }}>
          to access this app please join our official Telegram resources.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
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
                borderRadius: 10,
                background: resource.joined ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.08)',
                color: resource.joined ? '#22c55e' : '#fff',
                padding: '10px 13px',
                fontSize: 13,
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
            borderRadius: 8,
            background: '#fff',
            color: '#000',
            padding: '9px 18px',
            fontSize: 12,
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
