import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import DailyContestBanner from '@/components/DailyContestBanner';
import MissionDailyRewards from '@/components/MissionDailyRewards';
import PromoCodeInput from '@/components/PromoCodeInput';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import CreatePanel from '@/components/CreatePanel';
import { Plus } from 'lucide-react';
export default function Mission() {
  const [, setLocation] = useLocation();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const { data: appConfig } = useQuery<any>({ queryKey: ['/api/config/app'], staleTime: 300000, retry: false });
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-2 pb-24 text-white space-y-4">
        <DailyContestBanner prizePool={appConfig?.weeklyGiveawayAmount} onClick={() => setLocation('/leaderboard')} />
        <section style={{ marginBottom: 14 }} aria-label="Promo code">
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 4 }}>
            Promo Code
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2, marginBottom: 8, paddingLeft: 4 }}>
            Enter promo code and get rewards.
          </div>
          <PromoCodeInput />
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
        <button
          onClick={() => setCreateTaskOpen(true)}
          style={{
            position: 'fixed', left: '50%', bottom: 78, transform: 'translateX(-50%)', zIndex: 60,
            display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px',
            border: 0, borderRadius: 12, background: 'linear-gradient(135deg, #2563eb, #3b82f6)', color: '#fff',
            boxShadow: '0 8px 24px rgba(37,99,235,.38)', fontSize: 13, fontWeight: 800,
            whiteSpace: 'nowrap', cursor: 'pointer',
          }}
        >
          <Plus size={17} strokeWidth={3} color="#fff" />
          Add Task
          <span style={{
            position: 'absolute', top: -8, right: -9, minWidth: 25, height: 20,
            padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 900,
            lineHeight: 1, boxShadow: '0 3px 8px rgba(0,0,0,.3)',
          }}>30%</span>
        </button>
        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
