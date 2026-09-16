import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdWatchingSection from '@/components/AdWatchingSection';

export default function Mission() {
  const [tab, setTab] = useState<'daily' | 'community'>('daily');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <div style={{ display: 'flex', gap: 8 }} role="tablist" aria-label="Mission types">
          {(['daily', 'community'] as const).map((id) => (
            <button key={id} onClick={() => setTab(id)} role="tab" aria-selected={tab === id} style={{ flex: 1, height: 40, border: 0, borderRadius: 11, background: tab === id ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.07)', color: tab === id ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: 800, textTransform: 'capitalize' }}>{id === 'daily' ? 'Daily' : 'Community'}</button>
          ))}
        </div>
        {tab === 'daily' ? (
          <AdWatchingSection user={user} hideTitle={false} />
        ) : (
          <div className="space-y-4">
            <AdvertiserTaskFeed kind="social" title="Social Tasks" />
            <AdvertiserTaskFeed kind="game" title="Game Tasks" />
          </div>
        )}
      </main>
    </Layout>
  );
}
