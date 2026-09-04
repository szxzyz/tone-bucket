/**
 * SERVER-SIDE TON price service.
 * 
 * Aggregates live TON/USD price from CoinGecko → Binance → OKX with a 
 * 60-second server-side cache to avoid hammering external APIs.
 * 
 * Exports used by routes.ts:
 *   getLiveTonPriceUSD() → { price, source }
 *   convertGemsToTon(gemsAmount) → tonAmount
 *   gemsPerTon() → number of Gems per 1 TON (Fixed 10M)
 * 
 * Fixed constants:
 *   10,000,000 Gems = 1 TON (GEMS_PER_TON)
 */

// Gems to USDT is fixed: 100,000 Gems = 1 USDT
export const GEMS_PER_USD = 100_000;

interface PriceResult {
  price: number;
  source: string;
  fetchedAt: number;
}

let priceCache: PriceResult | null = null;
const CACHE_MS = 60_000; // 60-second server-side cache

/** Fetch TON/USD from CoinGecko. */
async function fetchCoinGecko(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data: any = await res.json();
  const price = data?.['the-open-network']?.usd;
  if (typeof price !== 'number' || price <= 0) throw new Error('CoinGecko: invalid price');
  return price;
}

/** Fetch TON/USD from Binance (TONUSDT ticker). */
async function fetchBinance(): Promise<number> {
  const res = await fetch(
    'https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data: any = await res.json();
  const price = parseFloat(data?.price);
  if (!isFinite(price) || price <= 0) throw new Error('Binance: invalid price');
  return price;
}

/** Fetch TON/USD from OKX (TON-USDT ticker). */
async function fetchOKX(): Promise<number> {
  const res = await fetch(
    'https://www.okx.com/api/v5/market/ticker?instId=TON-USDT',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`OKX ${res.status}`);
  const data: any = await res.json();
  const price = parseFloat(data?.data?.[0]?.last);
  if (!isFinite(price) || price <= 0) throw new Error('OKX: invalid price');
  return price;
}

/**
 * Returns live TON/USD price, aggregating from multiple exchanges.
 * Falls back through CoinGecko → Binance → OKX → stale cache → 5.5 default.
 */
export async function getLiveTonPriceUSD(): Promise<PriceResult> {
  const now = Date.now();

  // Serve cache if still fresh
  if (priceCache && now - priceCache.fetchedAt < CACHE_MS) {
    return priceCache;
  }

  const sources: Array<{ name: string; fn: () => Promise<number> }> = [
    { name: 'CoinGecko', fn: fetchCoinGecko },
    { name: 'Binance',   fn: fetchBinance },
    { name: 'OKX',       fn: fetchOKX },
  ];

  for (const source of sources) {
    try {
      const price = await source.fn();
      priceCache = { price, source: source.name, fetchedAt: now };
      return priceCache;
    } catch (err) {
      console.warn(`[TON price] ${source.name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // All sources failed — use stale cache if available
  if (priceCache) {
    console.warn('[TON price] All sources failed, serving stale cache');
    return { ...priceCache, source: `${priceCache.source} (stale)` };
  }

  // Last-resort default
  console.error('[TON price] All sources failed and no cache — using default 5.5');
  return { price: 5.5, source: 'default', fetchedAt: now };
}

/**
 * Converts a Gems amount to TON based on live price.
 * Formula: TON = (Gems / GEMS_PER_USD) / tonPriceUSD
 */
export async function convertGemsToTon(gemsAmount: number): Promise<number> {
  const { price } = await getLiveTonPriceUSD();
  const usdValue = gemsAmount / GEMS_PER_USD;
  return usdValue / price;
}

/**
 * Returns the number of Gems equivalent to 1 TON based on live price.
 */
export async function gemsPerTon(): Promise<number> {
  const { price } = await getLiveTonPriceUSD();
  return GEMS_PER_USD * price;
}
