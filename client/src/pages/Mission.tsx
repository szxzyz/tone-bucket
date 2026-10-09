import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import AdWatchingSection from '@/components/AdWatchingSection';
import MissionDailyRewards from '@/components/MissionDailyRewards';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import CreatePanel from '@/components/CreatePanel';

type MissionTab = 'ads' | 'daily' | 'community';

export default function Mission() {
  const [createTaskOpen, setCreateTaskOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === 'create');
  const [activeTab, setActiveTab] = useState<MissionTab>('ads');
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], retry: false });
  const tabStyle = (tab: MissionTab) => ({
    border: 0,
    borderRadius: 11,
    padding: '10px 6px',
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
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 4,
  } as const;
  return (
    <Layout onAddTask={() => setCreateTaskOpen(true)}>
      <main className="max-w-md mx-auto min-h-full px-3 pt-2 pb-24 text-white space-y-4 bg-black" style={{ background: '#000' }}>
        <section aria-label="Mission tabs" role="tablist" style={tabsStyle}>
          <button type="button" role="tab" aria-selected={activeTab === 'ads'} style={tabStyle('ads')} onClick={() => setActiveTab('ads')}>Ads</button>
          <button type="button" role="tab" aria-selected={activeTab === 'daily'} style={tabStyle('daily')} onClick={() => setActiveTab('daily')}>Daily</button>
          <button type="button" role="tab" aria-selected={activeTab === 'community'} style={tabStyle('community')} onClick={() => setActiveTab('community')}>Community</button>
        </section>

        {activeTab === 'ads' && (
          <section aria-labelledby="watch-ads-title">
            <h2 id="watch-ads-title" style={{ margin: '0 0 8px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Ad Tasks</h2>
            <AdWatchingSection user={user} hideTitle />
          </section>
        )}

        {activeTab === 'daily' && (
          <section aria-labelledby="daily-tasks-title">
            <h2 id="daily-tasks-title" style={{ margin: '0 0 8px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Task</h2>
            <p style={{ margin: '0 0 8px 4px', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>Complete daily tasks and claim your AXN rewards.</p>
            <MissionDailyRewards />
          </section>
        )}

        {activeTab === 'community' && (
          <>
            <AdvertiserTaskFeed kind="game" title="Bot Tasks" />
            <AdvertiserTaskFeed kind="social" title="Social Tasks" />
          </>
        )}
        <CreatePanel open={createTaskOpen} onClose={() => setCreateTaskOpen(false)} />
      </main>
    </Layout>
  );
}
