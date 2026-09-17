import { mnemonicToPrivateKey } from '@ton/crypto';
import { Address, internal, TonClient, WalletContractV4, toNano } from '@ton/ton';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { adminSettings } from '../shared/schema';

const TON_RPC_URL = process.env.TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC';
const TON_RPC_API_KEY = process.env.TON_RPC_API_KEY;
const PAYOUT_MNEMONIC = process.env.TON_PAYOUT_MNEMONIC?.trim();
const EXPECTED_WALLET = process.env.TON_PAYOUT_WALLET_ADDRESS?.trim();
const PAYOUT_COUNTER_KEY = 'automatic_ton_payout_counter';

export interface TonPayoutResult {
  transactionHash: string;
  senderAddress: string;
  recipientAddress: string;
  amountTon: string;
  memo: string;
}

async function allocatePayoutMemo(): Promise<string> {
  // The previous manual payout was #125, so the first automatic payout is #126.
  // The upsert increment is performed by PostgreSQL, making it safe if two
  // admins approve different withdrawals at the same time.
  const [row] = await db.insert(adminSettings).values({
    settingKey: PAYOUT_COUNTER_KEY,
    settingValue: '126',
    description: 'Next automatic TON payout number',
  }).onConflictDoUpdate({
    target: adminSettings.settingKey,
    set: { settingValue: sql`(${adminSettings.settingValue}::bigint + 1)::text`, updatedAt: new Date() },
  }).returning({ value: adminSettings.settingValue });
  const number = Number(row?.value);
  if (!Number.isSafeInteger(number) || number < 126) throw new Error('Invalid automatic payout counter');
  return `Axionet payout #${number}`;
}

function getClient(): TonClient {
  return new TonClient({
    endpoint: TON_RPC_URL,
    ...(TON_RPC_API_KEY ? { apiKey: TON_RPC_API_KEY } : {}),
  });
}

function requireMnemonic(): string[] {
  if (!PAYOUT_MNEMONIC) {
    throw new Error('TON_PAYOUT_MNEMONIC is not configured');
  }
  const words = PAYOUT_MNEMONIC.split(/\s+/).filter(Boolean);
  if (words.length < 12) throw new Error('TON_PAYOUT_MNEMONIC is invalid');
  return words;
}

/**
 * Sends a TON mainnet payout and returns the actual transaction hash.
 * The mnemonic is read only from the deployment secret and never logged.
 */
export async function sendAutomaticTonPayout(input: {
  withdrawalId: string;
  recipientAddress: string;
  amountTon: string;
}): Promise<TonPayoutResult> {
  const recipient = Address.parse(String(input.recipientAddress).trim());
  const rawAmount = String(input.amountTon).trim().replace(',', '.');
  const parsedAmount = Number(rawAmount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error(`Invalid TON payout amount: ${rawAmount || '(empty)'}`);
  }
  // TON supports nanoTON precision (9 decimals). Database decimal columns can
  // contain trailing precision beyond that, which toNano() rejects as an
  // invalid number. Normalize without ever rounding a payout upward.
  const nanoTonAmount = Math.floor(parsedAmount * 1_000_000_000);
  const amount = (nanoTonAmount / 1_000_000_000).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
  if (!amount || amount === '0') throw new Error('TON payout amount is below 1 nanoTON');
  const amountNano = toNano(amount);
  if (amountNano <= 0n) throw new Error('TON payout amount must be greater than zero');
  const memo = await allocatePayoutMemo();

  const keyPair = await mnemonicToPrivateKey(requireMnemonic());
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  const senderAddress = wallet.address.toString({ bounceable: false, testOnly: false });

  if (EXPECTED_WALLET) {
    const expected = Address.parse(EXPECTED_WALLET).toRawString();
    if (wallet.address.toRawString() !== expected) {
      throw new Error('Configured TON payout mnemonic does not match TON_PAYOUT_WALLET_ADDRESS');
    }
  }

  const client = getClient();
  const openedWallet = client.open(wallet);
  const balance = await client.getBalance(wallet.address);
  // Keep a reserve for TON forwarding fees and avoid draining the payout wallet.
  const feeReserve = toNano('0.05');
  if (balance < amountNano + feeReserve) {
    throw new Error(`Insufficient TON payout wallet balance: need ${amount} TON plus fees`);
  }

  const seqno = await openedWallet.getSeqno();
  await openedWallet.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [internal({
      to: recipient,
      value: amountNano,
      bounce: false,
      body: `${memo} (${input.withdrawalId})`,
    })],
  });

  // Wait until the wallet sequence advances, proving the broadcast was accepted.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (await openedWallet.getSeqno() > seqno) break;
  }
  if (await openedWallet.getSeqno() <= seqno) {
    throw new Error('TON payout broadcast was not confirmed before timeout');
  }

  const transactions = await client.getTransactions(wallet.address, { limit: 20 });
  const transaction = transactions.find(tx => tx.lt > 0n);
  if (!transaction) throw new Error('TON payout broadcast confirmed but transaction hash was unavailable');

  return {
    transactionHash: transaction.hash().toString('hex'),
    senderAddress,
    recipientAddress: recipient.toString({ bounceable: false, testOnly: false }),
    amountTon: amount,
    memo,
  };
}

export function isAutomaticTonPayoutConfigured(): boolean {
  return Boolean(PAYOUT_MNEMONIC);
}
