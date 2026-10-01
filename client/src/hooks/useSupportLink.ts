import { useQuery } from '@tanstack/react-query';

type AppConfig = { supportLink?: string };

/** Resolve the public support destination from SUPPORT_BOT_LINK via app config. */
export function useSupportLink(): string {
  const { data } = useQuery<AppConfig>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
    retry: false,
  });

  return String(data?.supportLink || import.meta.env.VITE_SUPPORT_LINK || '').trim();
}
