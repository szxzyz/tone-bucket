import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import AdWatchingSection from '@/components/AdWatchingSection';
import AdsRewardSummary from '@/components/AdsRewardSummary';
import MissionDailyRewards from '@/components/MissionDailyRewards';
import { StarterTasksSection } from '@/components/DailyMissionTasks';
import PromoCodeInput from '@/components/PromoCodeInput';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import CreatePanel from '@/components/CreatePanel';
export default function Mission() {
  const [createTaskOpen, setCreateTaskOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === 'create');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  return (
    <Layout onAddTask={() => setCreateTaskOpen(true)}>
      <main className="max-w-md mx-auto px-4 pt-2 pb-24 text-white space-y-4">
        <section style={{ marginBottom: 14 }} aria-label="Promo code">
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 4 }}>
            Promo Code
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2, marginBottom: 8, paddingLeft: 4 }}>
            Enter promo code and get rewards.
          </div>
          <div style={{ padding: 12, borderRadius: 16, background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)', boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}>
            <PromoCodeInput />
          </div>
        </section>
        <section aria-labelledby="watch-ads-title">
          <h2 id="watch-ads-title" style={{ margin: '0 0 3px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Watch Ads</h2>
          <p style={{ margin: '0 0 8px 4px', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
            Watch verified ads and earn AXN
          </p>
          <AdsRewardSummary />
          <AdWatchingSection user={user} hideTitle />
          <p style={{ margin: '16px 8px 0', color: 'rgba(255,255,255,0.4)', fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>
            Rewards credit only after the full duration is verified server-side
          </p>
        </section>
        <section>
          <h2 style={{ margin: '0 0 3px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Task</h2>
          <p style={{ margin: '0 0 8px 4px', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
            Complete daily task and get rewards
          </p>
          <MissionDailyRewards />
        </section>
        <StarterTasksSection />
        <AdvertiserTaskFeed kind="social" title="Social Tasks" />
        <AdvertiserTaskFeed kind="game" title="Game Tasks" />
        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
