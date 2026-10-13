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
const finalTierMigration = readFileSync(new URL('../migrations/0019_miner_tiers_111_128.sql', import.meta.url), 'utf8');
const finalAddedTiers = Array.from(
  finalTierMigration.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(finalAddedTiers.length, 18);
assert.deepEqual(finalAddedTiers.map((tier) => tier.level), Array.from({ length: 18 }, (_, index) => index + 111));
const latestTierMigration = readFileSync(new URL('../migrations/0020_miner_tiers_129_144.sql', import.meta.url), 'utf8');
const latestAddedTiers = Array.from(
  latestTierMigration.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(latestAddedTiers.length, 16);
assert.deepEqual(latestAddedTiers.map((tier) => tier.level), Array.from({ length: 16 }, (_, index) => index + 129));
const newestTierMigration = readFileSync(new URL('../migrations/0021_miner_tiers_145_168.sql', import.meta.url), 'utf8');
const newestAddedTiers = Array.from(
  newestTierMigration.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(newestAddedTiers.length, 24);
assert.deepEqual(newestAddedTiers.map((tier) => tier.level), Array.from({ length: 24 }, (_, index) => index + 145));
const finalTierSql = readFileSync(new URL('../migrations/0022_miner_tiers_169_248.sql', import.meta.url), 'utf8');
const newestTierRows = Array.from(
  finalTierSql.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(newestTierRows.length, 80);
assert.deepEqual(newestTierRows.map((tier) => tier.level), Array.from({ length: 80 }, (_, index) => index + 169));
const tierMigration249to394 = readFileSync(new URL('../migrations/0023_miner_tiers_249_394.sql', import.meta.url), 'utf8');
const tiers249to394 = Array.from(
  tierMigration249to394.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers249to394.length, 146);
assert.deepEqual(tiers249to394.map((tier) => tier.level), Array.from({ length: 146 }, (_, index) => index + 249));
const migration395to424 = readFileSync(new URL('../migrations/0024_miner_tiers_395_424.sql', import.meta.url), 'utf8');
const tiers395to424 = Array.from(
  migration395to424.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers395to424.length, 30);
assert.deepEqual(tiers395to424.map((tier) => tier.level), Array.from({ length: 30 }, (_, index) => index + 395));
const migration425to472 = readFileSync(new URL('../migrations/0025_miner_tiers_425_472.sql', import.meta.url), 'utf8');
const tiers425to472 = Array.from(
  migration425to472.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers425to472.length, 48);
assert.deepEqual(tiers425to472.map((tier) => tier.level), Array.from({ length: 48 }, (_, index) => index + 425));
const migration473to520 = readFileSync(new URL('../migrations/0026_miner_tiers_473_520.sql', import.meta.url), 'utf8');
const tiers473to520 = Array.from(
  migration473to520.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers473to520.length, 48);
assert.deepEqual(tiers473to520.map((tier) => tier.level), Array.from({ length: 48 }, (_, index) => index + 473));
assert.equal(tiers473to520.find((tier) => tier.level === 482)?.requiredHolding, 1_017_000);
assert.equal(tiers473to520.find((tier) => tier.level === 483)?.requiredHolding, 1_040_000);
assert.equal(tiers473to520.find((tier) => tier.level === 520)?.requiredHolding, 2_386_000);
const migration521to568 = readFileSync(new URL('../migrations/0027_miner_tiers_521_568.sql', import.meta.url), 'utf8');
const tiers521to568 = Array.from(
  migration521to568.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers521to568.length, 48);
assert.deepEqual(tiers521to568.map((tier) => tier.level), Array.from({ length: 48 }, (_, index) => index + 521));
assert.equal(tiers521to568.find((tier) => tier.level === 561)?.requiredHolding, 6_016_566.86);
assert.equal(tiers521to568.find((tier) => tier.level === 568)?.requiredHolding, 7_045_566.86);
const migration569to616 = readFileSync(new URL('../migrations/0028_miner_tiers_569_616.sql', import.meta.url), 'utf8');
const tiers569to616 = Array.from(
  migration569to616.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers569to616.length, 48);
assert.deepEqual(tiers569to616.map((tier) => tier.level), Array.from({ length: 48 }, (_, index) => index + 569));
assert.equal(tiers569to616.find((tier) => tier.level === 569)?.requiredHolding, 7_205_566.86);
assert.equal(tiers569to616.find((tier) => tier.level === 616)?.requiredHolding, 16_859_566.86);
assert.equal(tiers569to616.find((tier) => tier.level === 569)?.miningPowerTHs, 999.46);
assert.equal(tiers569to616.find((tier) => tier.level === 616)?.dailyYieldAXN, 31_858.5);
const migration617to672 = readFileSync(new URL('../migrations/0029_miner_tiers_617_672.sql', import.meta.url), 'utf8');
const tiers617to672 = Array.from(
  migration617to672.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers617to672.length, 56);
assert.deepEqual(tiers617to672.map((tier) => tier.level), Array.from({ length: 56 }, (_, index) => index + 617));
assert.equal(tiers617to672.find((tier) => tier.level === 617)?.requiredHolding, 17_019_566.86);
assert.equal(tiers617to672.find((tier) => tier.level === 656)?.requiredHolding, 24_579_566.86);
assert.equal(tiers617to672.find((tier) => tier.level === 672)?.requiredHolding, 28_569_566.86);
assert.equal(tiers617to672.find((tier) => tier.level === 617)?.miningPowerTHs, 1_281.3);
assert.equal(tiers617to672.find((tier) => tier.level === 672)?.dailyYieldAXN, 41_609.25);
const migration673to752 = readFileSync(new URL('../migrations/0030_miner_tiers_673_752.sql', import.meta.url), 'utf8');
const tiers673to752 = Array.from(
  migration673to752.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers673to752.length, 80);
assert.deepEqual(tiers673to752.map((tier) => tier.level), Array.from({ length: 80 }, (_, index) => index + 673));
assert.equal(tiers673to752.find((tier) => tier.level === 673)?.requiredHolding, 28_839_566.86);
assert.equal(tiers673to752.find((tier) => tier.level === 701)?.requiredHolding, 37_799_566.86);
assert.equal(tiers673to752.find((tier) => tier.level === 752)?.requiredHolding, 85_419_566.86);
assert.equal(tiers673to752.find((tier) => tier.level === 673)?.miningPowerTHs, 1_671.33);
assert.equal(tiers673to752.find((tier) => tier.level === 752)?.dailyYieldAXN, 57_789.5);
const migration753to832 = readFileSync(new URL('../migrations/0031_miner_tiers_753_832.sql', import.meta.url), 'utf8');
const tiers753to832 = Array.from(
  migration753to832.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers753to832.length, 80);
assert.deepEqual(tiers753to832.map((tier) => tier.level), Array.from({ length: 80 }, (_, index) => index + 753));
assert.equal(tiers753to832.find((tier) => tier.level === 753)?.requiredHolding, 86_799_566.86);
assert.equal(tiers753to832.find((tier) => tier.level === 832)?.requiredHolding, 261_499_566.86);
assert.equal(tiers753to832.find((tier) => tier.level === 753)?.miningPowerTHs, 2_320.27);
assert.equal(tiers753to832.find((tier) => tier.level === 832)?.dailyYieldAXN, 76_592.25);
const migration833to912 = readFileSync(new URL('../migrations/0032_miner_tiers_833_912.sql', import.meta.url), 'utf8');
const tiers833to912 = Array.from(
  migration833to912.matchAll(/\(\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g),
  (match) => ({
    level: Number(match[1]),
    requiredHolding: Number(match[2]),
    miningPowerTHs: Number(match[3]),
    dailyYieldAXN: Number(match[4]),
    displayValueUSD: Number(match[5]),
  }),
);
assert.equal(tiers833to912.length, 80);
assert.deepEqual(tiers833to912.map((tier) => tier.level), Array.from({ length: 80 }, (_, index) => index + 833));
assert.equal(tiers833to912.find((tier) => tier.level === 833)?.requiredHolding, 264_399_566.86);
assert.equal(tiers833to912.find((tier) => tier.level === 880)?.requiredHolding, 443_099_566.86);
assert.equal(tiers833to912.find((tier) => tier.level === 881)?.requiredHolding, 448_000_000);
assert.equal(tiers833to912.find((tier) => tier.level === 912)?.requiredHolding, 697_500_000);
assert.equal(tiers833to912.find((tier) => tier.level === 833)?.miningPowerTHs, 3_074.15);
assert.equal(tiers833to912.find((tier) => tier.level === 912)?.dailyYieldAXN, 98_048.75);
const allTiers = [...tiers, ...addedTiers, ...nextAddedTiers, ...finalAddedTiers, ...latestAddedTiers, ...newestAddedTiers, ...newestTierRows, ...tiers249to394, ...tiers395to424, ...tiers425to472, ...tiers473to520, ...tiers521to568, ...tiers569to616, ...tiers617to672, ...tiers673to752, ...tiers753to832, ...tiers833to912];

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
assert.equal(getMinerLevel(3253.99, allTiers).level, 110);
assert.equal(getMinerLevel(3254, allTiers).level, 111);
assert.equal(getMinerProgress(3214, getMinerLevel(3214, allTiers), allTiers).remaining, 40);
assert.equal(getMinerLevel(4011.99, allTiers).level, 127);
assert.equal(getMinerLevel(4012, allTiers).level, 128);
assert.equal(getMinerLevel(4060.99, allTiers).level, 128);
assert.equal(getMinerLevel(4061, allTiers).level, 129);
assert.equal(getMinerProgress(4012, getMinerLevel(4012, allTiers), allTiers).remaining, 49);
assert.equal(getMinerLevel(4884.99, allTiers).level, 143);
assert.equal(getMinerLevel(4885, allTiers).level, 144);
assert.equal(getMinerLevel(4945.99, allTiers).level, 144);
assert.equal(getMinerLevel(4946, allTiers).level, 145);
assert.equal(getMinerProgress(4885, getMinerLevel(4885, allTiers), allTiers).remaining, 61);
assert.equal(getMinerLevel(6564.99, allTiers).level, 167);
assert.equal(getMinerLevel(6565, allTiers).level, 168);
assert.equal(getMinerLevel(6646.99, allTiers).level, 168);
assert.equal(getMinerLevel(6647, allTiers).level, 169);
assert.equal(getMinerProgress(6565, getMinerLevel(6565, allTiers), allTiers).remaining, 82);
assert.equal(getMinerLevel(9890.99, allTiers).level, 200);
assert.equal(getMinerLevel(9891, allTiers).level, 201);
assert.equal(getMinerLevel(14429.99, allTiers).level, 224);
assert.equal(getMinerLevel(14430, allTiers).level, 225);
assert.equal(getMinerLevel(20729.99, allTiers).level, 247);
assert.equal(getMinerLevel(20730, allTiers).level, 248);
assert.equal(getMinerLevel(21059.99, allTiers).level, 248);
assert.equal(getMinerLevel(21060, allTiers).level, 249);
assert.equal(getMinerProgress(20730, getMinerLevel(20730, allTiers), allTiers).remaining, 330);
assert.equal(getMinerLevel(34849.99, allTiers).level, 280);
assert.equal(getMinerLevel(34850, allTiers).level, 281);
assert.equal(getMinerLevel(47000, allTiers).level, 300);
assert.equal(getMinerLevel(47590, allTiers).level, 301);
assert.equal(getMinerLevel(50019.99, allTiers).level, 304);
assert.equal(getMinerLevel(50020, allTiers).level, 305);
assert.equal(getMinerLevel(74459.99, allTiers).level, 336);
assert.equal(getMinerLevel(74460, allTiers).level, 337);
assert.equal(getMinerLevel(122499.99, allTiers).level, 376);
assert.equal(getMinerLevel(122500, allTiers).level, 377);
assert.equal(getMinerLevel(151299.99, allTiers).level, 393);
assert.equal(getMinerLevel(151300, allTiers).level, 394);
assert.equal(getMinerLevel(153199.99, allTiers).level, 394);
assert.equal(getMinerLevel(153200, allTiers).level, 395);
assert.equal(getMinerProgress(151300, getMinerLevel(151300, allTiers), allTiers).remaining, 1900);
assert.equal(getMinerLevel(166699.99, allTiers).level, 400);
assert.equal(getMinerLevel(166700, allTiers).level, 401);
assert.equal(getMinerLevel(278599.99, allTiers).level, 423);
assert.equal(getMinerLevel(278600, allTiers).level, 424);
assert.equal(getMinerLevel(284799.99, allTiers).level, 424);
assert.equal(getMinerLevel(284800, allTiers).level, 425);
assert.equal(getMinerProgress(278600, getMinerLevel(278600, allTiers), allTiers).remaining, 6200);
assert.equal(getMinerLevel(813499.99, allTiers).level, 471);
assert.equal(getMinerLevel(813500, allTiers).level, 472);
assert.equal(getMinerLevel(831799.99, allTiers).level, 472);
assert.equal(getMinerLevel(831800, allTiers).level, 473);
assert.equal(getMinerProgress(813500, getMinerLevel(813500, allTiers), allTiers).remaining, 18300);
assert.equal(getMinerLevel(1016999.99, allTiers).level, 481);
assert.equal(getMinerLevel(1017000, allTiers).level, 482);
assert.equal(getMinerLevel(2385999.99, allTiers).level, 519);
assert.equal(getMinerLevel(2386000, allTiers).level, 520);
assert.equal(getMinerLevel(2440999.99, allTiers).level, 520);
assert.equal(getMinerLevel(2441000, allTiers).level, 521);
assert.equal(getMinerProgress(2386000, getMinerLevel(2386000, allTiers), allTiers).remaining, 55000);
assert.equal(getMinerLevel(6016566.85, allTiers).level, 560);
assert.equal(getMinerLevel(6016566.86, allTiers).level, 561);
assert.equal(getMinerLevel(7045566.85, allTiers).level, 567);
assert.equal(getMinerLevel(7045566.86, allTiers).level, 568);
assert.equal(getMinerLevel(7205566.85, allTiers).level, 568);
assert.equal(getMinerLevel(7205566.86, allTiers).level, 569);
assert.equal(getMinerProgress(7045566.86, getMinerLevel(7045566.86, allTiers), allTiers).remaining, 160000);
assert.equal(getMinerLevel(16859566.85, allTiers).level, 615);
assert.equal(getMinerLevel(16859566.86, allTiers).level, 616);
assert.equal(getMinerLevel(17019566.85, allTiers).level, 616);
assert.equal(getMinerLevel(17019566.86, allTiers).level, 617);
assert.equal(getMinerProgress(16859566.86, getMinerLevel(16859566.86, allTiers), allTiers).remaining, 160000);
assert.equal(getMinerLevel(28569566.85, allTiers).level, 671);
assert.equal(getMinerLevel(28569566.86, allTiers).level, 672);
assert.equal(getMinerLevel(28839566.85, allTiers).level, 672);
assert.equal(getMinerLevel(28839566.86, allTiers).level, 673);
assert.equal(getMinerProgress(28569566.86, getMinerLevel(28569566.86, allTiers), allTiers).remaining, 270000);
assert.equal(getMinerLevel(85419566.85, allTiers).level, 751);
assert.equal(getMinerLevel(85419566.86, allTiers).level, 752);
assert.equal(getMinerLevel(86799566.85, allTiers).level, 752);
assert.equal(getMinerLevel(86799566.86, allTiers).level, 753);
assert.equal(getMinerProgress(85419566.86, getMinerLevel(85419566.86, allTiers), allTiers).remaining, 1380000);
assert.equal(getMinerLevel(261499566.85, allTiers).level, 831);
assert.equal(getMinerLevel(261499566.86, allTiers).level, 832);
assert.equal(getMinerProgress(261499566.86, getMinerLevel(261499566.86, allTiers), allTiers).remaining, 2900000);
assert.equal(getMinerLevel(264399566.85, allTiers).level, 832);
assert.equal(getMinerLevel(264399566.86, allTiers).level, 833);
assert.equal(getMinerLevel(443099566.85, allTiers).level, 879);
assert.equal(getMinerLevel(443099566.86, allTiers).level, 880);
assert.equal(getMinerLevel(447999999.99, allTiers).level, 880);
assert.equal(getMinerLevel(448000000, allTiers).level, 881);
assert.equal(getMinerLevel(697499999.99, allTiers).level, 911);
assert.equal(getMinerLevel(697500000, allTiers).level, 912);
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

console.log('miner logic and AXN display tests passed: levels 1–912, thresholds, progress, five-decimal USD, fractional/daily accrual, tier changes, cycle cap, negative time, and compact K/M/B formatting');
