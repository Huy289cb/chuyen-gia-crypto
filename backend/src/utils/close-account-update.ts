export interface CloseAccountUpdate {
  current_balance?: number; equity?: number; unrealized_pnl: number;
  realized_pnl?: {increment: number}; total_trades: {increment: number};
  winning_trades?: {increment: number}; losing_trades?: {increment: number};
  consecutive_losses: number | {increment: number}; last_trade_time: Date; updated_at: Date;
}
export function shouldUpdateClosedAccount(bookkeeping: boolean, fillVerified: boolean, binanceEnabled: boolean): boolean {
  return !bookkeeping && (fillVerified || !binanceEnabled);
}
/** Existing account bookkeeping semantics; economic ledger evidence is evaluated separately. */
export function buildCloseAccountUpdate(input: {balance: number; realizedPnl: number; lastTradeTime: Date; updatedAt: Date; walletAuthoritative?: boolean}): CloseAccountUpdate {
  const isWin = input.realizedPnl > 0.01, isLoss = input.realizedPnl < -0.01;
  const update: CloseAccountUpdate = {unrealized_pnl: 0, total_trades: {increment: 1}, consecutive_losses: isLoss ? {increment: 1} : 0,
    last_trade_time: input.lastTradeTime, updated_at: input.updatedAt};
  if (isWin || isLoss) {
    const balance = input.balance + input.realizedPnl;
    if (!input.walletAuthoritative) { update.current_balance = balance; update.equity = balance; }
    update.realized_pnl = {increment: input.realizedPnl};
    update.total_trades = {increment: 1}; update.winning_trades = {increment: isWin ? 1 : 0}; update.losing_trades = {increment: isLoss ? 1 : 0};
    update.consecutive_losses = isWin ? 0 : {increment: 1};
  }
  return update;
}
