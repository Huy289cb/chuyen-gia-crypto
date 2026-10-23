/** Local admin reset assignment only: neither a deposit nor exchange flatness proof. */
export function buildAccountResetUpdate(startingBalance:number,updatedAt:Date){
 return {current_balance:startingBalance,equity:startingBalance,unrealized_pnl:0,realized_pnl:0,
  total_trades:0,winning_trades:0,losing_trades:0,max_drawdown:0,consecutive_losses:0,
  last_trade_time:null,cooldown_until:null,updated_at:updatedAt};
}
