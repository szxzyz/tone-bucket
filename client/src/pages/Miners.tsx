import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Gauge, Hexagon, Lock, Pickaxe, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
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
const pageSize = 10;
const card: React.CSSProperties = {
  background: 'linear-gradient(155deg,#0e192d 0%,#0a1221 100%)',
  border: '1px solid rgba(127,154,190,.18)',
  borderRadius: 22,
  padding: 14,
  boxShadow: '0 8px 22px rgba(0,0,0,.24)',
};
const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const pretty = (value: number, max = 2) => value.toLocaleString('en', { maximumFractionDigits: max });
const centerUsd = (value: number) => value <= 0 ? '0' : value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
const smallUsd = (value: number) => value <= 0 ? '$0.00' : `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;

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
  const nextLevel = data?.nextLevel ?? null;
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

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
      {isLoading && <div style={{ ...card, gridColumn: '1 / -1', color: '#9ca3af' }}>Loading miner levels…</div>}
      {isError && <div style={{ ...card, gridColumn: '1 / -1', color: '#fca5a5' }}>Could not load miner levels. Please refresh.</div>}
      {visible.map((miner) => {
        const level = Number(miner.level);
        const active = level === currentLevel;
        const next = level === Number(nextLevel);
        const required = Math.max(0, Number(miner.requiredHolding));
        const power = Math.max(0, Number(miner.miningPowerTHs));
        const yieldPerDay = Math.max(0, Number(miner.dailyYieldAXN));
        const valueUsd = Math.max(0, Number(miner.displayValueUSD));
        const missing = Math.max(0, required - holding);
        const requiredUsd = required * axnUsdPrice;
        const missingUsd = missing * axnUsdPrice;
        const cardBorder = active ? '2px solid #12d4e8' : next ? '1px solid rgba(34,199,235,.36)' : '1px solid rgba(127,154,190,.18)';
        const buttonStyle: React.CSSProperties = {
          width: '100%', minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '0 8px', border: active || next ? 0 : '1px solid rgba(22,201,231,.17)', borderRadius: 14,
          background: active ? 'linear-gradient(105deg,#08c9df,#11d9ed)' : next ? 'linear-gradient(105deg,#06d4e8,#2588ff)' : '#171b23',
          color: active || next ? '#061321' : '#087f9a', fontSize: 12, fontWeight: 900, letterSpacing: '.025em', opacity: 1,
        };

        return <article key={level} style={{ ...card, minWidth: 0, padding: 12, border: cardBorder, display: 'flex', flexDirection: 'column', minHeight: 314 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ color: '#69d9ec', fontSize: 14, fontWeight: 800, letterSpacing: '.02em' }}>Level {level}</div>
            <div aria-hidden="true" style={{ position: 'relative', width: 24, height: 24, display: 'grid', placeItems: 'center', color: '#20d1ef', flexShrink: 0 }}>
              <Hexagon size={24} strokeWidth={1.9} />
              <Pickaxe size={10} strokeWidth={2} style={{ position: 'absolute' }} />
            </div>
          </div>

          <div style={{ marginTop: 12, minHeight: 88, boxSizing: 'border-box', border: '1px solid rgba(26,188,225,.34)', borderRadius: 20, background: 'linear-gradient(145deg,rgba(4,26,42,.92),rgba(7,24,38,.84))', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 5px' }}>
            <div style={{ color: '#5be4f5', fontSize: 21, lineHeight: 1.1, fontWeight: 950, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{centerUsd(valueUsd)} <span style={{ fontSize: 19 }}>$</span></div>
            <div style={{ color: '#a0adbc', fontSize: 11, letterSpacing: '.04em', marginTop: 5 }}>{pretty(required, 4)} AXN</div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ color: '#96a1b3', fontSize: 12 }}>Speed</span>
              <span style={{ color: '#f5f7fb', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Gauge size={13} color="#65dff3" />{pretty(power)} TH/s</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ color: '#55c9dc', fontSize: 12 }}>Base Rate</span>
              <span style={{ color: '#26d9b1', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}><TrendingUp size={13} color="#26d9b1" />+{pretty(yieldPerDay / 24)} AXN/hr</span>
            </div>
            <div style={{ color: '#9ea7b4', fontSize: 11, textAlign: 'center', marginTop: 1 }}>Req: {smallUsd(requiredUsd)} USD</div>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 12 }}>
            <button type="button" disabled aria-label={active ? `Level ${level} active` : next ? `Need ${pretty(missing, 4)} AXN to unlock level ${level}` : `Level ${level} locked`} style={buttonStyle}>
              {active ? <><ShieldCheck size={17} />ACTIVE</> : next ? <><Zap size={18} fill="currentColor" />NEED {pretty(missing, 4)} AXN</> : <Lock size={17} />}
            </button>
            {next && missing > 0 && <div style={{ color: '#62e2f3', fontSize: 12, fontWeight: 700, textAlign: 'center', marginTop: 8 }}>{smallUsd(missingUsd)} left to unlock</div>}
          </div>
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
