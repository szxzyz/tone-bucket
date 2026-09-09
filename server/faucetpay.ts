import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { payoutRecords } from '../shared/schema';
import { config } from './config';

type PayoutCurrency = 'TON' | 'LTC' | 'PEPE' | 'DGB' | 'USDT';

const CURRENCY_DECIMALS: Record<PayoutCurrency, number> = {
  TON: 9,
  LTC: 8,
  PEPE: 8,
  DGB: 8,
  USDT: 8,
};

export type CreatePayoutInput = {
  userId: string;
  recipientEmail: string;
  currency: PayoutCurrency;
  amount: string | number;
  source: string;
  metadata?: Record<string, unknown>;
};

/**
 * Creates a payout record. Mock mode is intentionally the default and never
 * sends funds. Live mode remains fail-closed until a real API implementation
 * is explicitly enabled with a server-side API key.
 */
export async function createFaucetPayPayout(input: CreatePayoutInput) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payout amount must be positive');
  if (!input.recipientEmail || input.recipientEmail.trim().length < 3) throw new Error('Valid FaucetPay recipient is required');

  const isLive = config.faucetPay.mode === 'live';
  const idempotencyReference = `${isLive ? 'fp' : 'mock_fp'}_${crypto.randomUUID()}`;

  if (isLive && !config.faucetPay.apiKey) {
    throw new Error('FaucetPay live mode requires FAUCETPAY_API_KEY');
  }

  if (isLive) {
    const decimals = CURRENCY_DECIMALS[input.currency];
    const smallestUnit = Math.floor(amount * 10 ** decimals);
    const body = new URLSearchParams({
      api_key: config.faucetPay.apiKey,
      to: input.recipientEmail.trim(),
      amount: String(smallestUnit),
      currency: input.currency,
      referral: 'false',
    });
    const response = await fetch('https://faucetpay.io/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const providerResponse = await response.json().catch(() => ({}));
    if (!response.ok || providerResponse.success === false || providerResponse.status === 'error' || providerResponse.error) {
      const message = providerResponse.message || providerResponse.error || providerResponse.description || `FaucetPay HTTP ${response.status}`;
      throw new Error(`FaucetPay payout failed: ${message}`);
    }
    const providerReference = providerResponse.payout_id || providerResponse.payment_id || providerResponse.transaction_id || providerResponse.txid || providerResponse.data?.payout_id || idempotencyReference;
    const [record] = await db.insert(payoutRecords).values({
      userId: input.userId,
      currency: input.currency,
      amount: amount.toFixed(10),
      recipientEmail: input.recipientEmail.trim(),
      status: 'paid',
      provider: 'faucetpay',
      providerReference: String(providerReference),
      source: input.source,
      metadata: { ...(input.metadata || {}), mode: 'live', providerResponse, smallestUnit, decimals },
    }).returning();
    return record;
  }

  const [record] = await db.insert(payoutRecords).values({
    userId: input.userId,
    currency: input.currency,
    amount: amount.toFixed(10),
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    status: 'mock_success',
    provider: 'faucetpay',
    providerReference: idempotencyReference,
    source: input.source,
    metadata: {
      ...(input.metadata || {}),
      mode: 'mock',
      usdtNetwork: config.faucetPay.usdtNetwork,
    },
  }).returning();

  return record;
}

export async function listUserPayouts(userId: string, limit = 50) {
  return db.select().from(payoutRecords)
    .where(eq(payoutRecords.userId, userId))
    .orderBy(desc(payoutRecords.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getPayoutById(userId: string, payoutId: string) {
  const [record] = await db.select().from(payoutRecords)
    .where(and(eq(payoutRecords.id, payoutId), eq(payoutRecords.userId, userId)))
    .limit(1);
  return record;
}

export function isFaucetPayMockMode() {
  return config.faucetPay.mode !== 'live';
}
