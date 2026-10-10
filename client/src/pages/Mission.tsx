import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import AdWatchingSection from '@/components/AdWatchingSection';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DailyCheckinSheet from '@/components/DailyCheckinSheet';

export default function Mission() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: checkinStatus } = useQuery<any>({ queryKey: ['/api/daily-checkin/status'], retry: false });
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], retry: false, staleTime: 5 * 60_000 });

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
        <section aria-labelledby="watch-ads-title">
          <h2 id="watch-ads-title" style={{ margin: '0 0 8px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Watch Ads</h2>
          <AdWatchingSection user={user} hideTitle />
        </section>
        <AdvertiserTaskFeed kind="social" title="Social Tasks" />
        <AdvertiserTaskFeed kind="game" title="Game Tasks" />
      </main>
    </Layout>
  );
}
