export function formatMinerUsd(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `$${safeValue.toFixed(5)}`;
}
