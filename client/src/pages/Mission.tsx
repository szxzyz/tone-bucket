import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import AdWatchingSection from '@/components/AdWatchingSection';
import DailyCheckinSheet from '@/components/DailyCheckinSheet';
import PromoCodeInput from '@/components/PromoCodeInput';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import CreatePanel from '@/components/CreatePanel';

type MissionTab = 'daily' | 'community' | 'partner';

export default function Mission() {
  const [createTaskOpen, setCreateTaskOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === 'create');
  const [activeTab, setActiveTab] = useState<MissionTab>('daily');
  const [checkinSheetOpen, setCheckinSheetOpen] = useState(false);
  const checkinShownRef = useRef(false);
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const { data: checkinStatus } = useQuery<any>({
    queryKey: ['/api/daily-checkin/status'],
    queryFn: async () => {
      const response = await fetch('/api/daily-checkin/status', { credentials: 'include' });
      if (!response.ok) return null;
      return response.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (checkinShownRef.current || !checkinStatus) return;
    checkinShownRef.current = true;
    if (!checkinStatus.alreadyClaimedToday) setCheckinSheetOpen(true);
  }, [checkinStatus]);

  const tabStyle = (tab: MissionTab) => ({
    flex: 1,
    height: 40,
    border: 0,
    borderRadius: 11,
    background: activeTab === tab ? 'rgba(59,130,246,0.22)' : 'transparent',
    color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  });

  return (
    <Layout onAddTask={() => setCreateTaskOpen(true)}>
      <main className="max-w-md mx-auto px-4 pt-2 pb-24 text-white space-y-4">
        <section aria-label="Mission tabs" style={{ padding: 4, borderRadius: 15, background: 'rgba(255,255,255,0.06)', display: 'flex', gap: 4 }}>
          <button type="button" style={tabStyle('daily')} onClick={() => setActiveTab('daily')}>Daily</button>
          <button type="button" style={tabStyle('community')} onClick={() => setActiveTab('community')}>Community</button>
          <button type="button" style={tabStyle('partner')} onClick={() => setActiveTab('partner')}>Partner</button>
        </section>
        {activeTab === 'daily' && (
          <>
            <section aria-labelledby="watch-ads-title">
              <h2 id="watch-ads-title" style={{ margin: '0 0 8px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Watch Ads</h2>
              <AdWatchingSection user={user} hideTitle />
            </section>
            <section aria-label="Promo code">
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 4, marginBottom: 8 }}>
                Promo Code
              </div>
              <div style={{ padding: 12, borderRadius: 16, background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)', boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
                <PromoCodeInput />
              </div>
            </section>
          </>
        )}
        {activeTab === 'community' && <AdvertiserTaskFeed kind="community" title="Community Tasks" />}
        {activeTab === 'partner' && <AdvertiserTaskFeed kind="partner" title="Partner Tasks" />}

        <DailyCheckinSheet
          open={checkinSheetOpen}
          onClose={() => setCheckinSheetOpen(false)}
          streak={checkinStatus?.streak ?? 0}
          dayIndex={checkinStatus?.dayIndex ?? 0}
          alreadyClaimedToday={checkinStatus?.alreadyClaimedToday ?? false}
          onClaimed={() => setCheckinSheetOpen(false)}
        />
        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
