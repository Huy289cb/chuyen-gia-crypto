/** Close reasons that must not change wallet PnL (DB cleanup only). */
const BOOKKEEPING_REASONS = new Set([
  'reconciliation_bookkeeping',
  'reconciliation_closed_not_on_binance',
  'stale_ghost_open',
]);

/** Internal / sync labels — hide from trade history or show PnL=0. */
const INTERNAL_CLOSE_REASONS = new Set([
  ...BOOKKEEPING_REASONS,
  'reconciliation_fill',
  'reconciliation_sync_closed_on_binance',
]);

export function isBookkeepingCloseReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (BOOKKEEPING_REASONS.has(reason)) return true;
  return reason.startsWith('merged_into_');
}

export function isInternalCloseReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (INTERNAL_CLOSE_REASONS.has(reason)) return true;
  return reason.startsWith('merged_into_');
}
