export interface ReconcilePositionCosts {realized_pnl:number|null;entry_fee:number;exit_fee:number;funding_fee:number}
/** Exact existing local reconciliation arithmetic; not proof of exchange ledger coverage. */
export function buildWalletReconcileUpdate(startingBalance:number,snapshot:{walletBalance:number;equity:number;unrealizedPnl:number},positions:readonly ReconcilePositionCosts[],updatedAt:Date){
 return {starting_balance:startingBalance,current_balance:snapshot.walletBalance,equity:snapshot.equity,unrealized_pnl:snapshot.unrealizedPnl,
  realized_pnl:positions.reduce((sum,p)=>sum+(Number(p.realized_pnl)||0),0),
  accumulated_trading_fees:positions.reduce((sum,p)=>sum+p.entry_fee+p.exit_fee,0),
  accumulated_funding_fee:positions.reduce((sum,p)=>sum+p.funding_fee,0),updated_at:updatedAt};
}
