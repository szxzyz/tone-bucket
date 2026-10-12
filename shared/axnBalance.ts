/**
 * Canonical AXN amount exposed to the app for the legacy users.balance column.
 * Some older records store a fractional TON-equivalent; those are represented
 * in the UI at 10,000,000 AXN per stored unit. Whole-number records are already
 * AXN amounts. Keep this logic shared by display and withdrawal validation.
 */
export const AXN_PER_LEGACY_BALANCE_UNIT = 10_000_000;

export function toAxnBalance(rawValue: unknown): number {
  const rawBalance = Number(rawValue ?? 0);
  if (!Number.isFinite(rawBalance)) return 0;
  return Math.round(rawBalance < 1 ? rawBalance * AXN_PER_LEGACY_BALANCE_UNIT : rawBalance);
}

/** Convert an AXN withdrawal amount back into the representation stored on the
 * user's row, so debit and rejection refund preserve the displayed balance.
 */
export function axnAmountToStoredBalance(rawValue: unknown, axnAmount: number): string {
  const rawBalance = Number(rawValue ?? 0);
  const storedAmount = rawBalance < 1
    ? axnAmount / AXN_PER_LEGACY_BALANCE_UNIT
    : axnAmount;
  return Number.isFinite(storedAmount) ? storedAmount.toFixed(10) : '0.0000000000';
}
