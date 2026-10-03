import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import Layout from '@/components/Layout';
import ReferralContestSection from '@/components/ReferralContestSection';
import AdWatchContestSection from '@/components/AdWatchContestSection';

export default function Leaderboard() {
  useAuth();
  const [activeTab, setActiveTab] = useState<'ad' | 'ref'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('contest') === 'ref' || params.get('section') === 'referral-contest' ? 'ref' : 'ad';
  });

  return (
    <Layout>
      <div style={{ background: '#0a0a0a', minHeight: '100%' }}>
        <div style={{ margin: '12px 12px 0', padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }} role="tablist" aria-label="Leaderboard contests">
          {([['ad', 'Ad Contest'], ['ref', 'Ref Contest']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} style={{ border: 0, borderRadius: 11, padding: '10px 8px', background: activeTab === id ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'transparent', color: activeTab === id ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        {activeTab === 'ad' ? <AdWatchContestSection /> : <ReferralContestSection />}
      </div>
    </Layout>
  );
}
