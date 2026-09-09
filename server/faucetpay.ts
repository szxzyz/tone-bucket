import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { payoutRecords } from '../shared/schema';
import { config } from './config';

type PayoutCurrency = 'TON' | 'LTC' | 'PEPE' | 'DGB' | 'USDT';

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

  const idempotencyReference = `mock_fp_${crypto.randomUUID()}`;
  const isLive = config.faucetPay.mode === 'live';
  const status = isLive ? 'pending_provider' : 'mock_success';

  if (isLive && !config.faucetPay.apiKey) {
    throw new Error('FaucetPay live mode requires FAUCETPAY_API_KEY');
  }

  const [record] = await db.insert(payoutRecords).values({
    userId: input.userId,
    currency: input.currency,
    amount: amount.toFixed(10),
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    status,
    provider: 'faucetpay',
    providerReference: idempotencyReference,
    source: input.source,
    metadata: {
      ...(input.metadata || {}),
      mode: isLive ? 'live-not-yet-connected' : 'mock',
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
