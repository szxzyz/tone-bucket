import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateAccruedAxn, getEligibleHolding, getMinerLevel, getMinerProgress } from '../shared/minerLogic';
import { formatCompactAxn } from '../client/src/lib/formatAxn';
import { formatMinerUsd } from '../client/src/lib/formatMinerUsd';

const tiers = [
  { level: 1, requiredHolding: 0, miningPowerTHs: 0.20, dailyYieldAXN: 5, displayValueUSD: 0.0002422 },
  { level: 2, requiredHolding: 100, miningPowerTHs: 0.24, dailyYieldAXN: 6, displayValueUSD: 0.00029065 },
  { level: 3, requiredHolding: 101, miningPowerTHs: 0.28, dailyYieldAXN: 7, displayValueUSD: 0.00033909 },
  { level: 4, requiredHolding: 102, miningPowerTHs: 0.31, dailyYieldAXN: 7.75, displayValueUSD: 0.00037542 },
  { level: 5, requiredHolding: 105, miningPowerTHs: 0.35, dailyYieldAXN: 8.75, displayValueUSD: 0.00042386 },
  { level: 6, requiredHolding: 108, miningPowerTHs: 0.39, dailyYieldAXN: 9.75, displayValueUSD: 0.0004723 },
  { level: 7, requiredHolding: 112, miningPowerTHs: 0.42, dailyYieldAXN: 10.5, displayValueUSD: 0.00050863 },
  { level: 8, requiredHolding: 117, miningPowerTHs: 0.46, dailyYieldAXN: 11.5, displayValueUSD: 0.00055708 },
  { level: 9, requiredHolding: 123, miningPowerTHs: 0.50, dailyYieldAXN: 12.5, displayValueUSD: 0.00060552 },
  { level: 10, requiredHolding: 130, miningPowerTHs: 0.53, dailyYieldAXN: 13.25, displayValueUSD: 0.00064185 },
];

const tierMigration = readFileSync(new URL('../migrations/0017_miner_tiers_11_56.sql', import.meta.url), 'utf8');
const addedTiers = Array.from(
  tierMigration.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(addedTiers.length, 46);
assert.deepEqual(addedTiers.map((tier) => tier.level), Array.from({ length: 46 }, (_, index) => index + 11));
const nextTierMigration = readFileSync(new URL('../migrations/0018_miner_tiers_57_110.sql', import.meta.url), 'utf8');
const nextAddedTiers = Array.from(
  nextTierMigration.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(nextAddedTiers.length, 54);
assert.deepEqual(nextAddedTiers.map((tier) => tier.level), Array.from({ length: 54 }, (_, index) => index + 57));
const allTiers = [...tiers, ...addedTiers, ...nextAddedTiers];

assert.equal(getEligibleHolding('0'), 0);
assert.equal(getMinerLevel(0, tiers).level, 1);
assert.equal(getMinerLevel(15, tiers).level, 1);
assert.equal(getMinerProgress(15, getMinerLevel(15, tiers), tiers).remaining, 85);
assert.equal(getMinerLevel(100, tiers).level, 2);
assert.equal(getMinerLevel(101, tiers).level, 3);
assert.equal(getMinerLevel(102, tiers).level, 4);
assert.equal(getMinerLevel(130, tiers).level, 10);
assert.equal(getMinerLevel(99.99, tiers).level, 1);
assert.equal(getMinerLevel(136.99, allTiers).level, 10);
assert.equal(getMinerLevel(137, allTiers).level, 11);
assert.equal(getMinerProgress(130, getMinerLevel(130, allTiers), allTiers).remaining, 7);
assert.equal(getMinerLevel(1036.99, allTiers).level, 55);
assert.equal(getMinerLevel(1037, allTiers).level, 56);
assert.equal(getMinerLevel(1068.99, allTiers).level, 56);
assert.equal(getMinerLevel(1069, allTiers).level, 57);
assert.equal(getMinerProgress(1037, getMinerLevel(1037, allTiers), allTiers).remaining, 32);
assert.equal(getMinerLevel(3213.99, allTiers).level, 109);
assert.equal(getMinerLevel(3214, allTiers).level, 110);
assert.equal(formatMinerUsd(0.00064185), '$0.00064');
assert.equal(formatMinerUsd(0.006), '$0.00600');
assert.equal(formatMinerUsd(0), '$0.00000');
for (const [value, expected] of [[1, '1'], [1_000, '1K'], [1_100, '1.1K'], [10_000, '10K'], [100_000, '100K'], [1_000_000, '1M'], [1_000_000_000, '1B']] as const) {
  assert.equal(formatCompactAxn(value), expected);
}

const oneHour = calculateAccruedAxn(0, 5, 0, 0, 3_600_000, 3_600);
assert.equal(oneHour, Number((5 / 24).toFixed(10)));
const halfDay = calculateAccruedAxn(0.25, 6, 0, 0, 43_200_000, 86_400);
assert.equal(halfDay, 3.25);
assert.equal(calculateAccruedAxn(0.25, 6, 10_000, 20_000, 15_000, 86_400), 0.25);
assert.equal(calculateAccruedAxn(0, 5, 0, 86_400_000, 172_800_000, 3_600), 0);
assert.equal(calculateAccruedAxn(0, 5, 0, 0, 86_400_000, Number.POSITIVE_INFINITY), 5);
const beforeUpgrade = calculateAccruedAxn(0, 5, 0, 0, 86_400_000, Number.POSITIVE_INFINITY);
assert.equal(calculateAccruedAxn(beforeUpgrade, 6, 86_400_000, 86_400_000, 172_800_000, Number.POSITIVE_INFINITY), 11);
const beforeDowngrade = calculateAccruedAxn(0, 6, 0, 0, 86_400_000, Number.POSITIVE_INFINITY);
assert.equal(calculateAccruedAxn(beforeDowngrade, 5, 86_400_000, 86_400_000, 172_800_000, Number.POSITIVE_INFINITY), 11);

console.log('miner logic and AXN display tests passed: levels 1–110, thresholds, progress, five-decimal USD, fractional/daily accrual, tier changes, cycle cap, negative time, and compact K/M/B formatting');
