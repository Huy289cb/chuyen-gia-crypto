/** Legacy manual-route local bookkeeping. This does not prove an exchange close. */
export function buildManualCloseAccountUpdate(input: {balance:number;realizedPnl:number;lastTradeTime:Date;updatedAt:Date}) {
 const isWin=input.realizedPnl>0;
 return {current_balance:input.balance+input.realizedPnl,equity:input.balance+input.realizedPnl,
  unrealized_pnl:0,realized_pnl:{increment:input.realizedPnl},total_trades:{increment:1},
  winning_trades:{increment:isWin?1:0},losing_trades:{increment:isWin?0:1},
  consecutive_losses:isWin?0:{increment:1},last_trade_time:input.lastTradeTime,updated_at:input.updatedAt};
}
