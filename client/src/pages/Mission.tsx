import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import AdWatchingSection from '@/components/AdWatchingSection';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import DailyCheckinSheet from '@/components/DailyCheckinSheet';

type MissionTab = 'ads' | 'community';

export default function Mission() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MissionTab>('ads');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: checkinStatus } = useQuery<any>({ queryKey: ['/api/daily-checkin/status'], retry: false });
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], retry: false, staleTime: 5 * 60_000 });

  const tabStyle = (tab: MissionTab) => ({
    border: 0,
    borderRadius: 11,
    padding: '10px 8px',
    background: activeTab === tab ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'transparent',
    color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  });

  const tabsStyle = {
    margin: '12px 0 10px',
    padding: 4,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.06)',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 4,
  } as const;

  return (
    <Layout>
      <main className="max-w-md mx-auto min-h-full px-3 pt-2 pb-24 text-white space-y-4 bg-black" style={{ background: '#000' }}>
        <section aria-labelledby="daily-checkin-title" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="daily-checkin-title" style={{ margin: '0 0 0 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Check-In</h2>
          <DailyCheckinSheet
            open={true}
            dayIndex={checkinStatus?.dayIndex ?? 0}
            alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? false}
            adsgramBlockId={appConfig?.adsgramCheckinBlockId || ""}
            onClaimed={() => {
              queryClient.invalidateQueries({ queryKey: ['/api/daily-checkin/status'] });
              queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
              queryClient.invalidateQueries({ queryKey: ['/api/missions/status'] });
            }}
          />
        </section>
        <section aria-label="Mission tabs" role="tablist" style={tabsStyle}>
          <button type="button" style={tabStyle('ads')} onClick={() => setActiveTab('ads')}>Ads</button>
          <button type="button" style={tabStyle('community')} onClick={() => setActiveTab('community')}>Community</button>
        </section>
        {activeTab === 'ads' && (
          <>
            <section aria-labelledby="watch-ads-title">
              <h2 id="watch-ads-title" style={{ margin: '0 0 8px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Watch Ads</h2>
              <AdWatchingSection user={user} hideTitle />
            </section>
          </>
        )}
        {activeTab === 'community' && (
          <>
            <AdvertiserTaskFeed kind="game" title="Game Tasks" />
            <AdvertiserTaskFeed kind="social" title="Social Tasks" />
          </>
        )}


      </main>
    </Layout>
  );
}
