export interface MinerTier {
  level: number;
  requiredHolding: number;
  miningPowerTHs: number;
  dailyYieldAXN: number;
  displayValueUSD: number;
}

export function getEligibleHolding(rawBalance: unknown): number {
  const value = Number(rawBalance ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getMinerLevel(holding: number, tiers: MinerTier[]): MinerTier {
  const sorted = [...tiers].sort((a, b) => a.requiredHolding - b.requiredHolding || a.level - b.level);
  const eligible = Number.isFinite(holding) ? Math.max(0, holding) : 0;
  return sorted.filter((tier) => tier.requiredHolding <= eligible).at(-1) ?? sorted[0] ?? {
    level: 1, requiredHolding: 0, miningPowerTHs: 0, dailyYieldAXN: 0, displayValueUSD: 0,
  };
}

export function getMinerProgress(holding: number, current: MinerTier, tiers: MinerTier[]) {
  const next = [...tiers]
    .filter((tier) => tier.level > current.level)
    .sort((a, b) => a.requiredHolding - b.requiredHolding || a.level - b.level)[0] ?? null;
  const remaining = next ? Math.max(0, next.requiredHolding - holding) : 0;
  const span = next ? next.requiredHolding - current.requiredHolding : 0;
  const progressPercent = next && span > 0
    ? Math.min(100, Math.max(0, ((holding - current.requiredHolding) / span) * 100))
    : next ? 100 : 100;
  return { next, remaining, progressPercent };
}

export function calculateAccruedAxn(
  existing: number,
  dailyYield: number,
  miningStartedAtMs: number,
  lastAccrualAtMs: number,
  nowMs: number,
  durationSeconds: number,
): number {
  const endMs = Number.isFinite(durationSeconds)
    ? miningStartedAtMs + Math.max(0, durationSeconds) * 1000
    : Number.POSITIVE_INFINITY;
  const fromMs = Math.max(miningStartedAtMs, lastAccrualAtMs);
  const toMs = Math.min(nowMs, endMs);
  const elapsedSeconds = Math.max(0, toMs - fromMs) / 1000;
  const safeExisting = Number.isFinite(existing) ? Math.max(0, existing) : 0;
  const safeYield = Number.isFinite(dailyYield) ? Math.max(0, dailyYield) : 0;
  return Number((safeExisting + safeYield * elapsedSeconds / 86400).toFixed(10));
}

export function normalizeAxnAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0.0000000000';
  return amount.toFixed(10);
}
