/** Exact local repository operations; callers retain economic/provenance responsibility. */
export function buildRepositoryBalanceUpdate(newBalance: number, pnl: number, updatedAt: Date) {
  return { current_balance: newBalance, equity: newBalance,
    realized_pnl: { increment: pnl }, updated_at: updatedAt };
}
export function buildRepositoryStatsUpdate(isWin: boolean, now: Date) {
  return { total_trades: { increment: 1 }, winning_trades: { increment: isWin ? 1 : 0 },
    losing_trades: { increment: isWin ? 0 : 1 }, consecutive_losses: isWin ? 0 : { increment: 1 },
    last_trade_time: now, updated_at: now };
}
