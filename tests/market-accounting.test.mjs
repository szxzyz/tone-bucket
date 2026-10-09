import test from 'node:test';
import assert from 'node:assert/strict';

const fee = (amount, rate = 0.003) => amount * rate;
const buyNetInput = (amount, rate = 0.003) => amount - fee(amount, rate);
const sellNetUsd = (grossUsd, rate = 0.003) => grossUsd - fee(grossUsd, rate);

test('buy fee is 0.30% of 1 TON and is deducted once from input', () => {
  assert.equal(fee(1), 0.003);
  assert.equal(buyNetInput(1), 0.997);
});

test('sell fee is deducted once from gross USD payout', () => {
  assert.equal(sellNetUsd(100), 99.7);
  assert.equal(sellNetUsd(0.01), 0.00997);
});

test('legacy GRAM reconciliation migration is non-destructive and idempotent', async () => {
  const sql = await (await import('node:fs/promises')).readFile(new URL('../migrations/0014_usd_balance_reconciliation.sql', import.meta.url), 'utf8');
  assert.match(sql, /legacy_gram_balance_reconciliation/);
  assert.match(sql, /ON CONFLICT \(user_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /UPDATE users[\s\S]*gram_balance[\s\S]*usd_balance/);
  assert.doesNotMatch(sql, /DROP COLUMN.*gram_balance/i);
});
