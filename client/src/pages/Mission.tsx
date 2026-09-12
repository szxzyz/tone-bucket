import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdWatchingSection from '@/components/AdWatchingSection';

export default function Mission() {
  const [tab, setTab] = useState<'social' | 'game'>('social');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <div style={{ display: 'flex', gap: 8 }} role="tablist" aria-label="Mission types">
          {(['social', 'game'] as const).map((id) => (
            <button key={id} onClick={() => setTab(id)} role="tab" aria-selected={tab === id} style={{ flex: 1, height: 40, border: 0, borderRadius: 11, background: tab === id ? 'linear-gradient(135deg, #3d1580, #6b21a8)' : 'rgba(255,255,255,0.07)', color: tab === id ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: 800, textTransform: 'capitalize' }}>{id} Tasks</button>
          ))}
        </div>
        {tab === 'social' ? <AdvertiserTaskFeed kind="social" title="Social Missions" subtitle="Complete channel and social tasks to earn rewards." /> : <AdvertiserTaskFeed kind="game" title="Game Missions" subtitle="Launch games and complete tasks to earn rewards." />}
        <AdWatchingSection user={user} hideTitle={false} />
      </main>
    </Layout>
  );
}
