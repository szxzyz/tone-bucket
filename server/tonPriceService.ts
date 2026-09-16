/**
 * SERVER-SIDE TON price service.
 * 
 * Aggregates live TON/USD price from CoinGecko, Binance, and OKX with a
 * short server-side cache. A withdrawal must never silently use a hardcoded
 * price when market providers are unavailable.
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
  stale?: boolean;
}

let priceCache: PriceResult | null = null;
const CACHE_MS = 15_000; // Keep withdrawal snapshots close to market price.

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

/** Fetch TON/USD from TonAPI (TON-native rate service). */
async function fetchTonAPI(): Promise<number> {
  const res = await fetch(
    'https://tonapi.io/v2/rates?tokens=ton&currencies=usd',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`TonAPI ${res.status}`);
  const data: any = await res.json();
  const price = Number(data?.rates?.TON?.prices?.USD);
  if (!isFinite(price) || price <= 0) throw new Error('TonAPI: invalid price');
  return price;
}

/** Fetch TON/USD from STON.fi's public TON asset catalogue. */
async function fetchSTONFi(): Promise<number> {
  const res = await fetch(
    'https://api.ston.fi/v1/assets',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`STON.fi ${res.status}`);
  const data: any = await res.json();
  const tonAsset = Array.isArray(data?.asset_list)
    ? data.asset_list.find((asset: any) => asset?.symbol === 'TON' || asset?.display_name === 'Toncoin')
    : undefined;
  const price = Number(tonAsset?.third_party_usd_price ?? tonAsset?.dex_usd_price);
  if (!isFinite(price) || price <= 0) throw new Error('STON.fi: invalid price');
  return price;
}

/**
 * Returns a live TON/USD price aggregated from every provider that responds.
 * The median prevents one exchange/API outlier from setting the withdrawal
 * value. A stale cache is labelled explicitly and is never presented as live.
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
    { name: 'TonAPI',    fn: fetchTonAPI },
    { name: 'STON.fi',   fn: fetchSTONFi },
  ];

  const results = await Promise.all(sources.map(async (source) => {
    try {
      return { name: source.name, price: await source.fn() };
    } catch (err) {
      console.warn(`[TON price] ${source.name} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }));
  const liveResults = results.filter((result): result is { name: string; price: number } => result !== null);
  if (liveResults.length > 0) {
    const sortedPrices = liveResults.map(result => result.price).sort((a, b) => a - b);
    const middle = Math.floor(sortedPrices.length / 2);
    const price = sortedPrices.length % 2 === 1
      ? sortedPrices[middle]
      : (sortedPrices[middle - 1] + sortedPrices[middle]) / 2;
    priceCache = { price, source: liveResults.map(result => result.name).join('+'), fetchedAt: now };
    console.log(`[TON price] live ${price.toFixed(6)} USD from ${priceCache.source}`);
    return priceCache;
  }

  // All sources failed — use stale cache if available
  if (priceCache) {
    console.warn('[TON price] All sources failed, serving stale cache');
    return { ...priceCache, source: `${priceCache.source} (stale)`, stale: true };
  }

  // Do not invent a market price. Callers can decide whether a stale quote is
  // acceptable; withdrawal routes explicitly reject this source.
  throw new Error('Live TON price unavailable from CoinGecko, Binance, and OKX');
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
