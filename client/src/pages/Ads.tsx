import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/Layout';
import AdWatchingSection from '@/components/AdWatchingSection';
import { apiRequest } from '@/lib/queryClient';

type ProviderId = 'adsgram' | 'monetag' | 'gigapub' | 'uslads';
type ProviderSpec = {
  id: ProviderId;
  watched: number;
  limit: number;
  reward: number;
  enabled: boolean;
  configured: boolean;
};

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function formatGold(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function useAdResetCountdown() {
  const [countdown, setCountdown] = useState('––h ––m ––s');
  const [nextResetLabel, setNextResetLabel] = useState('––:–– UTC');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const day = now.getUTCDate();
      const resetMorning = new Date(Date.UTC(year, month, day, 6, 30, 0, 0));
      const resetEvening = new Date(Date.UTC(year, month, day, 18, 30, 0, 0));

      let nextReset: Date;
      let label: string;
      if (now < resetMorning) {
        nextReset = resetMorning;
        label = '6:30 AM UTC';
      } else if (now < resetEvening) {
        nextReset = resetEvening;
        label = '6:30 PM UTC';
      } else {
        nextReset = new Date(Date.UTC(year, month, day + 1, 6, 30, 0, 0));
        label = '6:30 AM UTC';
      }

      const totalSeconds = Math.max(0, Math.floor((nextReset.getTime() - now.getTime()) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setNextResetLabel(label);
      setCountdown(`${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`);
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return { countdown, nextResetLabel };
}

function AdResetTimer() {
  const { countdown, nextResetLabel } = useAdResetCountdown();

  return (
    <div
      aria-label={`Ad limit resets at ${nextResetLabel}, in ${countdown}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
        padding: '4px 6px', flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 999,
        background: 'linear-gradient(90deg, #0d0d1a 0%, #1a0d3d 35%, #3d1580 65%, #6b21a8 100%)',
        border: '1px solid rgba(216,180,254,0.16)',
      }}
    >
      <Clock size={11} color="rgba(216,180,254,0.85)" strokeWidth={2.5} aria-hidden="true" />
      <span style={{ fontSize: 7, fontWeight: 800, color: 'rgba(216,180,254,0.8)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Reset
      </span>
      <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(216,180,254,0.9)', fontFamily: 'Roboto Mono, monospace' }}>
        {nextResetLabel.replace(' ', '\u00a0')}
      </span>
      <span style={{ fontSize: 8, fontWeight: 800, color: '#e9d5ff', fontVariantNumeric: 'tabular-nums', fontFamily: 'Roboto Mono, monospace' }}>
        {countdown}
      </span>
    </div>
  );
}

function AdsRewardSummary() {
  const { data: user, isLoading: userLoading } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });
  const { data: appSettings, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/app-settings');
      if (!response.ok) throw new Error('Unable to load ad settings');
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: appConfig, isLoading: configLoading } = useQuery<any>({
    queryKey: ['/api/config/app'],
    staleTime: 5 * 60_000,
  });

  const specs: ProviderSpec[] = [
    {
      id: 'adsgram',
      watched: numberOr(user?.adsWatchedToday, 0),
      limit: numberOr(appSettings?.adsgramAdLimit ?? appSettings?.dailyAdLimit, 40),
      reward: numberOr(appSettings?.adsgramRewardPerAd ?? appSettings?.rewardPerAdGems ?? appSettings?.rewardPerAd, 50),
      enabled: appSettings?.adsgramEnabled !== false,
      configured: Boolean(appConfig?.adsgramRewardBlockId || import.meta.env.VITE_ADSGRAM_BLOCK_ID),
    },
    {
      id: 'monetag',
      watched: numberOr(user?.monetagAdsWatchedToday, 0),
      limit: numberOr(appSettings?.monetagAdLimit, 30),
      reward: numberOr(appSettings?.monetagRewardPerAd, 30),
      enabled: appSettings?.monetagEnabled !== false,
      configured: Boolean(appConfig?.monetagZoneId || import.meta.env.VITE_MONETAG_ZONE_ID || import.meta.env.MONETAG_ZONE_ID),
    },
    {
      id: 'gigapub',
      watched: numberOr(user?.gigapubAdsWatchedToday, 0),
      limit: numberOr(appSettings?.gigapubAdLimit, 30),
      reward: numberOr(appSettings?.gigapubRewardPerAd, 30),
      enabled: appSettings?.gigapubEnabled !== false,
      configured: Boolean(appConfig?.gigapubScriptId || import.meta.env.VITE_GIGAPUB_SCRIPT_ID),
    },
    {
      id: 'uslads',
      watched: numberOr(user?.usladsAdsWatchedToday, 0),
      limit: numberOr(appSettings?.usladsAdLimit, 20),
      reward: numberOr(appSettings?.usladsRewardPerAd, 20),
      enabled: appSettings?.usladsEnabled !== false,
      configured: Boolean(appConfig?.uslAdsPlacementId || import.meta.env.VITE_USL_ADS_PLACEMENT_ID || 'plc_992db36dbed33f7c'),
    },
  ];

  const summaryLoading = userLoading || settingsLoading || configLoading || !user || !appSettings || !appConfig;
  const activeProviders = specs.filter((provider) => provider.enabled && provider.configured);
  const watched = activeProviders.reduce((total, provider) => total + provider.watched, 0);
  const limit = activeProviders.reduce((total, provider) => total + provider.limit, 0);
  const remaining = activeProviders.reduce((total, provider) => total + Math.max(0, provider.limit - provider.watched), 0);
  const todayReward = activeProviders.reduce((total, provider) => total + provider.watched * provider.reward, 0);
  const potentialEarning = activeProviders.reduce((total, provider) => total + Math.max(0, provider.limit - provider.watched) * provider.reward, 0);

  const displayed = (value: number) => summaryLoading ? '—' : formatGold(value);

  return (
    <section aria-label="Ad rewards summary" style={{ marginBottom: 12 }}>
      <div
        style={{
          width: '100%', boxSizing: 'border-box', padding: 14, borderRadius: 16,
          background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)',
          border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 22px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Today reward
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ color: '#facc15', fontSize: 24, lineHeight: 1, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                +{displayed(todayReward)}
              </span>
              <img src="/assets/gems-icon.svg" alt="Gold" style={{ width: 21, height: 21, objectFit: 'contain' }} />
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 800 }}>GOLD</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
          <SummaryMetric label="Watched" value={summaryLoading ? '—' : formatGold(watched)} />
          <SummaryMetric label="Remaining" value={summaryLoading ? '—' : formatGold(remaining)} />
          <SummaryMetric label="Daily limit" value={summaryLoading ? '—' : `${formatGold(watched)} / ${formatGold(limit)}`} />
        </div>

        <div style={{ marginTop: 11, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Potential earning
            </p>
            <p style={{ margin: '3px 0 0', color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>
              From remaining ads this reset period
            </p>
          </div>
          <p style={{ margin: 0, flexShrink: 0, color: '#c4b5fd', fontSize: 16, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
            +{displayed(potentialEarning)} <span style={{ fontSize: 9, letterSpacing: '0.04em' }}>GOLD</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, padding: '9px 8px', borderRadius: 11, background: 'rgba(255,255,255,0.045)' }}>
      <p style={{ margin: 0, color: 'rgba(255,255,255,0.42)', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        {label}
      </p>
      <p style={{ margin: '4px 0 0', color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </p>
    </div>
  );
}

export default function Ads() {
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white">
        <section aria-labelledby="viewing-ads-title" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h1 id="viewing-ads-title" style={{ margin: 0, color: '#fff', fontSize: 15, lineHeight: 1.2, fontWeight: 900, flexShrink: 1, whiteSpace: 'nowrap' }}>
              Viewing Ads
            </h1>
            <AdResetTimer />
          </div>
          <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 1.4 }}>
            Get paid for watching short ads on Telegram.
          </p>
        </section>

        <AdsRewardSummary />
        <AdWatchingSection user={user} hideTitle />
        <p style={{ margin: '16px 8px 0', color: 'rgba(255,255,255,0.4)', fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>
          Rewards credit only after the full duration is verified server-side
        </p>
      </main>
    </Layout>
  );
}
