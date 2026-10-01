import Layout from '@/components/Layout';
import AdvertiserTaskFeed from '@/components/AdvertiserTaskFeed';
import MissionFastAccess from '@/components/MissionFastAccess';
import { useState } from 'react';
import CreatePanel from '@/components/CreatePanel';
import { Plus } from 'lucide-react';
export default function Mission() {
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-24 text-white space-y-4">
        <MissionFastAccess />
        <section>
          <h2 style={{ margin: '0 0 8px 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Tasks</h2>
          <div role="status" style={{ padding: '22px 16px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(145deg, #1a1c20 0%, #121317 100%)', boxShadow: '0 8px 22px rgba(0,0,0,0.25)', textAlign: 'center', color: 'rgba(255,255,255,0.52)', fontSize: 13, fontWeight: 600 }}>
            No daily tasks are available right now.
          </div>
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
