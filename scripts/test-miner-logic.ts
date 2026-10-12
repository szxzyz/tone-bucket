import assert from 'node:assert/strict';
import { calculateAccruedAxn, getEligibleHolding, getMinerLevel, getMinerProgress } from '../shared/minerLogic';

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

assert.equal(getEligibleHolding('0'), 0);
assert.equal(getMinerLevel(0, tiers).level, 1);
assert.equal(getMinerLevel(15, tiers).level, 1);
assert.equal(getMinerProgress(15, getMinerLevel(15, tiers), tiers).remaining, 85);
assert.equal(getMinerLevel(100, tiers).level, 2);
assert.equal(getMinerLevel(101, tiers).level, 3);
assert.equal(getMinerLevel(102, tiers).level, 4);
assert.equal(getMinerLevel(130, tiers).level, 10);
assert.equal(getMinerLevel(99.99, tiers).level, 1);

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

console.log('miner logic tests passed: thresholds, progress, fractional/daily accrual, tier changes, cycle cap, and negative time');
