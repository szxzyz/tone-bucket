// TON price fetching service - gets live market data
let cachedPrice: { price: number; lastUpdated: number } | null = null;
const CACHE_DURATION = 15000; // Match the server quote cache.

export async function getTONPrice(): Promise<number> {
  const now = Date.now();
  
  // Return cached price if still valid
  if (cachedPrice && now - cachedPrice.lastUpdated < CACHE_DURATION) {
    return cachedPrice.price;
  }

  try {
    // Always use the server's aggregated quote so app and Telegram agree.
    const response = await fetch('/api/ton-price', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) throw new Error('Failed to fetch TON price');
    
    const data = await response.json();
    const price = Number(data?.price);
    
    if (!price || typeof price !== 'number') {
      throw new Error('Invalid price data');
    }

    // Cache the price
    cachedPrice = { price, lastUpdated: now };
    return price;
  } catch (error) {
    console.error('Error fetching TON price:', error);
    
    throw error;
  }
}

export function calculateConversions(tonPriceUSD: number) {
  // AXN to USDT is fixed: 100,000 AXN = 1 USD
  // USDT to TON depends on market price (tonPriceUSD)
  const GEMS_PER_DOLLAR = 100_000;
  const gemsPerTon = GEMS_PER_DOLLAR * tonPriceUSD;
  
  return {
    tonPriceUSD,
    gemsPerTon,
    dollarPerTon: tonPriceUSD,
    tonPerDollar: 1 / tonPriceUSD,
    gemsPerDollar: GEMS_PER_DOLLAR,
    tonPerGem: 1 / gemsPerTon,
  };
}

// AXN -> TON conversion based on market price
// Calculation: (AXN / 100,000) / tonPriceUSD
export function gemsToTon(gems: number, tonPriceUSD: number): number {
  const usdValue = (Number(gems) || 0) / 100_000;
  return usdValue / tonPriceUSD;
}

// TON -> USD conversion using live market price
export function tonToUsd(ton: number, tonPriceUSD: number): number {
  return Number((Number(ton) * tonPriceUSD).toFixed(6));
}

export function formatTon(value: number | null | undefined): string {
  const v = Number(value) || 0;
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatUsd(value: number | null | undefined): string {
  const v = Number(value) || 0;
  // Use more decimals for small values to avoid $0.00
  return "$" + v.toLocaleString("en-US", { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: v < 0.01 ? 6 : 4 
  });
}
