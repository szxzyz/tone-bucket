export const APP_VERSION = "1.0.0";
export const SWAG_TO_USD = 100_000; // 100,000 Gold = 1 USDT
export const APP_COLORS = {
  primary: "#4aa8ff", // light blue
  background: "#000000", // pure black
  text: "#d9e6ff", // light white/blue
};

/**
 * Convert SWAG to USD
 * @param powAmount - Amount in SWAG
 * @returns Amount in USDT (Gold / 100,000)
 */
export function powToUSD(powAmount: number | string): number {
  const numValue = typeof powAmount === 'string' ? parseFloat(powAmount) : powAmount;
  return numValue / SWAG_TO_USD;
}

/**
 * Convert USD to SWAG
 * @param usdAmount - Amount in USD
 * @returns Amount in Gold (USDT * 100,000)
 */
export function usdToSWAG(usdAmount: number | string): number {
  const numValue = typeof usdAmount === 'string' ? parseFloat(usdAmount) : usdAmount;
  return Math.round(numValue * SWAG_TO_USD);
}

/**
 * Format large numbers into compact format (1k, 1.2M, 1B, 1T)
 * @param num - Number to format
 * @returns Formatted string (e.g., "1.2M", "154k", "24B", "1.5T")
 */
export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000_000) {
    return (num / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '') + 'T';
  }
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}
