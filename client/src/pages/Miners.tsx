import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Pickaxe } from 'lucide-react';
import { useLocation } from 'wouter';
import Layout from '@/components/Layout';

interface MinerTier {
  level: number;
  requiredHolding: string | number;
  miningPowerTHs: string | number;
  dailyYieldAXN: string | number;
  displayValueUSD: string | number;
}
interface MinersData {
  eligibleHolding: number;
  currentLevel: number;
  nextLevel: number | null;
  remainingAXN: number;
  progressPercent: number;
  miners: MinerTier[];
}
const pageSize = 5;
const card: React.CSSProperties = { background: 'linear-gradient(145deg,#191b20,#101115)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 18, padding: 16 };
const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const pretty = (value: number, max = 2) => value.toLocaleString('en', { maximumFractionDigits: max });

export default function Miners() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(0);
  const { data, isLoading, isError } = useQuery<MinersData>({ queryKey: ['/api/miners'] });
  const miners = data?.miners ?? [];
  const pages = Math.max(1, Math.ceil(miners.length / pageSize));
  const visible = useMemo(() => miners.slice(page * pageSize, (page + 1) * pageSize), [miners, page]);
  const holding = Math.max(0, Number(data?.eligibleHolding ?? 0));

  return <Layout><main className="max-w-md mx-auto min-h-full px-3 pt-3 pb-24 text-white bg-black">
    <button type="button" onClick={() => setLocation('/mining')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'transparent', color: '#a8b4c7', padding: '8px 2px', fontSize: 12, fontWeight: 800 }}><ArrowLeft size={16}/> Mining</button>
    <header style={{ margin: '6px 2px 16px' }}><h1 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>Explore Miners</h1><p style={{ color: '#858993', fontSize: 12, margin: '5px 0 0' }}>Your eligible holding: <b style={{ color: '#fff' }}>{compact(holding)} AXN</b></p></header>
    <section style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div><div style={{ color: '#9297a2', fontSize: 10, fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>Current Miner</div><div style={{ fontSize: 22, fontWeight: 950, marginTop: 4 }}>Level {data?.currentLevel ?? 1}</div></div>
        <div style={{ textAlign: 'right' }}><div style={{ color: '#9297a2', fontSize: 10, fontWeight: 800 }}>NEXT LEVEL</div><div style={{ fontSize: 15, fontWeight: 900, marginTop: 5 }}>{data?.nextLevel ? `${pretty(data.remainingAXN, 4)} AXN left` : 'Top level reached'}</div></div>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,.08)', marginTop: 14, overflow: 'hidden' }}><div style={{ width: `${data?.progressPercent ?? 0}%`, height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,#2563eb,#60a5fa)' }}/></div>
    </section>
    {isLoading && <div style={{ ...card, color: '#9ca3af' }}>Loading miner levels…</div>}
    {isError && <div style={{ ...card, color: '#fca5a5' }}>Could not load miner levels. Please refresh.</div>}
    <div style={{ display: 'grid', gap: 10 }}>
      {visible.map((miner) => {
        const active = miner.level === (data?.currentLevel ?? 1);
        const required = Number(miner.requiredHolding);
        const power = Number(miner.miningPowerTHs);
        const yieldPerDay = Number(miner.dailyYieldAXN);
        const value = Number(miner.displayValueUSD);
        const missing = Math.max(0, required - Number(data?.eligibleHolding ?? 0));
        return <article key={miner.level} style={{ ...card, borderColor: active ? 'rgba(59,130,246,.45)' : 'rgba(255,255,255,.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: active ? 'rgba(37,99,235,.2)' : 'rgba(255,255,255,.06)', color: active ? '#60a5fa' : '#a1a1aa' }}><Pickaxe size={18}/></div><div><div style={{ fontWeight: 950, fontSize: 16 }}>Miner Level {miner.level}</div><div style={{ color: '#858993', fontSize: 11, marginTop: 3 }}>Requires {compact(required)} AXN</div></div></div>
            <span style={{ padding: '5px 8px', borderRadius: 99, fontSize: 9, fontWeight: 950, letterSpacing: '.06em', color: active ? '#86efac' : missing > 0 ? '#fbbf24' : '#a1a1aa', background: active ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.06)' }}>{active ? 'ACTIVE · YOUR LEVEL' : missing > 0 ? `NEED ${compact(missing)} AXN` : 'UNLOCKED'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 14 }}>
            <div><div style={{ color: '#858993', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>Mining power</div><div style={{ marginTop: 4, fontWeight: 900, fontSize: 13 }}>{pretty(power, 2)} TH/s</div></div>
            <div><div style={{ color: '#858993', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>Daily yield</div><div style={{ marginTop: 4, fontWeight: 900, fontSize: 13 }}>{pretty(yieldPerDay, 2)} AXN/Day</div></div>
            <div><div style={{ color: '#858993', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>Estimate*</div><div style={{ marginTop: 4, fontWeight: 900, fontSize: 13 }}>${value.toFixed(8)}</div></div>
          </div>
          {!active && missing > 0 && <div style={{ marginTop: 12, color: '#9ca3af', fontSize: 11 }}>Hold {pretty(missing, 4)} more AXN to reach this level.</div>}
        </article>;
      })}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
      <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page" style={{ ...card, padding: '9px 12px', color: '#fff', opacity: page === 0 ? .4 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}><ChevronLeft size={16}/> Previous</button>
      <span style={{ color: '#9ca3af', fontSize: 11 }}>Page {page + 1} of {pages}</span>
      <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page" style={{ ...card, padding: '9px 12px', color: '#fff', opacity: page >= pages - 1 ? .4 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}>Next <ChevronRight size={16}/></button>
    </div>
    <p style={{ color: '#626670', fontSize: 10, textAlign: 'center', marginTop: 12 }}>*USD values are temporary estimates, not live prices.</p>
  </main></Layout>;
}
