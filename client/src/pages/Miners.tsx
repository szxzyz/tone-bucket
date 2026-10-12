import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Coins, DollarSign, Gauge, Pickaxe, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
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
const pageSize = 6;
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
    <div style={{ color: '#858993', fontSize: 12, margin: '4px 2px 14px' }}>Eligible holding: <b style={{ color: '#fff' }}>{compact(holding)} AXN</b></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
      {isLoading && <div style={{ ...card, gridColumn: '1 / -1', color: '#9ca3af' }}>Loading miner levels…</div>}
      {isError && <div style={{ ...card, gridColumn: '1 / -1', color: '#fca5a5' }}>Could not load miner levels. Please refresh.</div>}
      {visible.map((miner) => {
        const active = miner.level === (data?.currentLevel ?? 1);
        const required = Number(miner.requiredHolding);
        const power = Number(miner.miningPowerTHs);
        const yieldPerDay = Number(miner.dailyYieldAXN);
        const value = Number(miner.displayValueUSD);
        const missing = Math.max(0, required - holding);
        const status = active ? 'ACTIVE' : missing > 0 ? `NEED ${compact(missing)} AXN` : 'UNLOCKED';
        const statusColor = active ? '#86efac' : missing > 0 ? '#fbbf24' : '#a1a1aa';
        return <article key={miner.level} style={{ ...card, minWidth: 0, padding: 12, borderColor: active ? 'rgba(59,130,246,.45)' : 'rgba(255,255,255,.07)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 5 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pickaxe size={16} color={active ? '#60a5fa' : '#a1a1aa'} />
                <div style={{ fontWeight: 950, fontSize: 14, whiteSpace: 'nowrap' }}>Level {miner.level}</div>
              </div>
              <div title="Required AXN holding" aria-label={`Required holding: ${pretty(required, 4)} AXN`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#858993', fontSize: 10, marginTop: 5 }}><Coins size={12} />{compact(required)} AXN</div>
            </div>
            <span style={{ flexShrink: 0, maxWidth: '50%', padding: '4px 6px', borderRadius: 99, fontSize: 8, lineHeight: 1.1, fontWeight: 950, letterSpacing: '.03em', textAlign: 'center', color: statusColor, background: active ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.06)' }}>{status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, marginTop: 12 }}>
            <div title={`Mining power: ${pretty(power, 2)} TH/s`} aria-label={`Mining power ${pretty(power, 2)} terahashes per second`} style={{ minWidth: 0, textAlign: 'center' }}>
              <Gauge size={14} color="#60a5fa" />
              <div style={{ marginTop: 3, fontWeight: 900, fontSize: 11, whiteSpace: 'nowrap' }}>{pretty(power, 2)}</div>
              <div style={{ color: '#858993', fontSize: 9 }}>TH/s</div>
            </div>
            <div title={`Daily yield: ${pretty(yieldPerDay, 2)} AXN/day`} aria-label={`Daily yield ${pretty(yieldPerDay, 2)} AXN per day`} style={{ minWidth: 0, textAlign: 'center' }}>
              <TrendingUp size={14} color="#86efac" />
              <div style={{ marginTop: 3, fontWeight: 900, fontSize: 11, whiteSpace: 'nowrap' }}>{pretty(yieldPerDay, 2)}</div>
              <div style={{ color: '#858993', fontSize: 9 }}>AXN/day</div>
            </div>
            <div title={`Temporary USD estimate: $${value.toFixed(8)}`} aria-label={`Temporary USD estimate ${value.toFixed(8)} dollars`} style={{ minWidth: 0, textAlign: 'center' }}>
              <DollarSign size={14} color="#c4b5fd" />
              <div style={{ marginTop: 3, fontWeight: 900, fontSize: 10, whiteSpace: 'nowrap' }}>{value.toFixed(8)}</div>
              <div style={{ color: '#858993', fontSize: 9 }}>USD*</div>
            </div>
          </div>
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
