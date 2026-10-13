import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Gauge, Pickaxe, TrendingUp } from 'lucide-react';
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
const card: React.CSSProperties = { background: 'linear-gradient(145deg,#191b20,#101115)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 18, padding: 14 };
const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const pretty = (value: number, max = 2) => value.toLocaleString('en', { maximumFractionDigits: max });
const usd = (value: number, digits = 4) => `$${Math.max(0, value).toFixed(digits)}`;

export default function Miners() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(0);
  const { data, isLoading, isError } = useQuery<MinersData>({
    queryKey: ['/api/miners'],
    refetchInterval: 15_000,
    staleTime: 0,
  });
  const miners = data?.miners ?? [];
  const holding = Math.max(0, Number(data?.eligibleHolding ?? 0));
  const currentLevel = Math.max(1, Number(data?.currentLevel ?? 1));
  const visibleTiers = useMemo(
    () => miners.filter((miner) => Number(miner.level) >= currentLevel),
    [miners, currentLevel],
  );
  const pages = Math.max(1, Math.ceil(visibleTiers.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = useMemo(
    () => visibleTiers.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [visibleTiers, safePage],
  );
  // The seeded tier USD estimates encode a consistent approximate AXN/USD rate.
  // Deriving the rate from the server-provided tiers keeps required/remaining values aligned with those estimates.
  const axnUsdPrice = useMemo(() => {
    const prices = miners
      .map((tier) => Number(tier.dailyYieldAXN) > 0 ? Number(tier.displayValueUSD) / Number(tier.dailyYieldAXN) : 0)
      .filter((price) => Number.isFinite(price) && price > 0)
      .sort((a, b) => a - b);
    return prices.length ? prices[Math.floor(prices.length / 2)] : 0.00004844;
  }, [miners]);

  return <Layout><main className="max-w-md mx-auto min-h-full px-3 pt-3 pb-24 text-white bg-black">
    <button type="button" onClick={() => setLocation('/mining')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'transparent', color: '#a8b4c7', padding: '8px 2px', fontSize: 12, fontWeight: 800 }}><ArrowLeft size={16}/> Mining</button>
    <div style={{ color: '#858993', fontSize: 12, margin: '4px 2px 14px' }}>Eligible holding: <b style={{ color: '#fff' }}>{compact(holding)} AXN</b></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
      {isLoading && <div style={{ ...card, gridColumn: '1 / -1', color: '#9ca3af' }}>Loading miner levels…</div>}
      {isError && <div style={{ ...card, gridColumn: '1 / -1', color: '#fca5a5' }}>Could not load miner levels. Please refresh.</div>}
      {visible.map((miner) => {
        const active = Number(miner.level) === currentLevel;
        const required = Math.max(0, Number(miner.requiredHolding));
        const power = Math.max(0, Number(miner.miningPowerTHs));
        const yieldPerDay = Math.max(0, Number(miner.dailyYieldAXN));
        const valueUsd = Math.max(0, Number(miner.displayValueUSD));
        const missing = Math.max(0, required - holding);
        const needLabel = `Need ${pretty(missing, 4)} AXN`;
        const requiredUsd = required * axnUsdPrice;
        const missingUsd = missing * axnUsdPrice;

        return <article key={miner.level} style={{ ...card, minWidth: 0, padding: 12, borderColor: active ? 'rgba(59,130,246,.45)' : 'rgba(255,255,255,.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Pickaxe size={16} color={active ? '#60a5fa' : '#a1a1aa'} />
              <div style={{ fontWeight: 950, fontSize: 14, whiteSpace: 'nowrap' }}>Level {miner.level}</div>
            </div>
            <button type="button" disabled aria-label={active ? `Level ${miner.level} active` : needLabel} style={{ flexShrink: 0, maxWidth: '54%', padding: '5px 7px', border: 0, borderRadius: 99, fontSize: 9, lineHeight: 1.1, fontWeight: 950, whiteSpace: 'nowrap', color: active ? '#86efac' : '#fbbf24', background: active ? 'rgba(34,197,94,.12)' : 'rgba(251,191,36,.12)', opacity: 1 }}>{active ? 'Active' : needLabel}</button>
          </div>

          <div style={{ textAlign: 'center', padding: '13px 4px 12px', margin: '10px 0', borderTop: '1px solid rgba(255,255,255,.06)', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ color: '#fff', fontSize: 19, lineHeight: 1.15, fontWeight: 950, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{usd(valueUsd, 8)}</div>
            <div style={{ color: '#858993', fontSize: 9, fontWeight: 800, marginTop: 3 }}>USD</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 6px' }}>
            <div>
              <div style={{ color: '#858993', fontSize: 10, fontWeight: 800 }}>Speed</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' }}><Gauge size={13} color="#60a5fa" />{pretty(power)} TH/s</div>
            </div>
            <div>
              <div style={{ color: '#858993', fontSize: 10, fontWeight: 800 }}>Base Rate</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' }}><TrendingUp size={13} color="#86efac" />{pretty(yieldPerDay)} AXN/day</div>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 8 }}>
              <span style={{ color: '#858993', fontSize: 10, fontWeight: 800 }}>Required</span>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap' }}>{usd(requiredUsd)} USD</span>
            </div>
          </div>

          {!active && missing > 0 && <div style={{ marginTop: 10, color: '#fbbf24', fontSize: 10, fontWeight: 800, textAlign: 'center' }}>{usd(missingUsd)} left to unlock</div>}
        </article>;
      })}
      {!isLoading && !isError && visible.length === 0 && <div style={{ ...card, gridColumn: '1 / -1', color: '#9ca3af' }}>No miner levels available.</div>}
    </div>
    {pages > 1 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
      <button type="button" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} aria-label="Previous page" style={{ ...card, padding: '9px 12px', color: '#fff', opacity: safePage === 0 ? .4 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}><ChevronLeft size={16}/> Previous</button>
      <span style={{ color: '#9ca3af', fontSize: 11 }}>Page {safePage + 1} of {pages}</span>
      <button type="button" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1} aria-label="Next page" style={{ ...card, padding: '9px 12px', color: '#fff', opacity: safePage >= pages - 1 ? .4 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}>Next <ChevronRight size={16}/></button>
    </div>}
    <p style={{ color: '#626670', fontSize: 10, textAlign: 'center', marginTop: 12 }}>*USD values are temporary estimates, not live prices.</p>
  </main></Layout>;
}
