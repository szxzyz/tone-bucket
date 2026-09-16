import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdWatchingSection from '@/components/AdWatchingSection';
import CreatePanel from '@/components/CreatePanel';
import { Plus } from 'lucide-react';
export default function Mission() {
  const [tab, setTab] = useState<'daily' | 'community'>('daily');
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
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
        <button
          onClick={() => setCreateTaskOpen(true)}
          style={{
            position: 'fixed', left: '50%', bottom: 78, transform: 'translateX(-50%)', zIndex: 60,
            display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px',
            border: 0, borderRadius: 14, background: '#252525', color: '#fff',
            boxShadow: '0 8px 24px rgba(0,0,0,.45)', fontSize: 13, fontWeight: 800,
            whiteSpace: 'nowrap', cursor: 'pointer',
          }}
        >
          <Plus size={17} strokeWidth={3} color="#3b82f6" />
          Add Task
          <span style={{ color: '#60a5fa', fontSize: 10, fontWeight: 900 }}>30% OFF</span>
        </button>
        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
