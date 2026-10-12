/** Compact AXN amounts consistently for the header and mining pool UI. */
export function formatCompactAxn(rawAmount: unknown): string {
  const parsed = Number(rawAmount ?? 0);
  const amount = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}
