import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import DailyContestBanner from '@/components/DailyContestBanner';
import MissionDailyRewards from '@/components/MissionDailyRewards';
import PromoCodeInput from '@/components/PromoCodeInput';
import { useState } from 'react';
import { useLocation } from 'wouter';
import CreatePanel from '@/components/CreatePanel';
import { Plus } from 'lucide-react';
export default function Mission() {
  const [, setLocation] = useLocation();
  const [createTaskOpen, setCreateTaskOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === 'create');
  return (
    <Layout onAddTask={() => setCreateTaskOpen(true)}>
      <main className="max-w-md mx-auto px-4 pt-2 pb-24 text-white space-y-4">
        <DailyContestBanner onClick={() => setLocation('/affiliates?section=referral-contest')} />
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
        <section>
          <h2 style={{ margin: '0 0 3px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Task</h2>
          <p style={{ margin: '0 0 8px 4px', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
            Complete daily task and get rewards
          </p>
          <MissionDailyRewards />
        </section>
        <AdvertiserTaskFeed kind="social" title="Social Tasks" />
        <AdvertiserTaskFeed kind="game" title="Game Tasks" />
        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
