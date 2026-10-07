import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import AdWatchingSection from '@/components/AdWatchingSection';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import CreatePanel from '@/components/CreatePanel';

type MissionTab = 'daily' | 'community';

export default function Mission() {
  const [createTaskOpen, setCreateTaskOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === 'create');
  const [activeTab, setActiveTab] = useState<MissionTab>('daily');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });

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
    margin: '0 0 10px',
    padding: 4,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.06)',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 4,
  } as const;

  return (
    <Layout onAddTask={() => setCreateTaskOpen(true)}>
      <main className="max-w-md mx-auto min-h-full px-4 pt-2 pb-24 text-white space-y-4 bg-black" style={{ background: '#000' }}>
        <section aria-label="Mission tabs" role="tablist" style={tabsStyle}>
          <button type="button" style={tabStyle('daily')} onClick={() => setActiveTab('daily')}>Daily</button>
          <button type="button" style={tabStyle('community')} onClick={() => setActiveTab('community')}>Community</button>
        </section>
        {activeTab === 'daily' && (
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

        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
