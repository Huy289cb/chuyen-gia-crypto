export interface NetStatisticsPosition {realized_pnl:number;entry_fee:number;exit_fee:number;funding_fee:number}
/** Preserve caller's descending close-time order and legacy threshold semantics. */
export function buildNetTradeStatistics(positions:readonly NetStatisticsPosition[]){
 let streak=0;for(const p of positions){if(p.realized_pnl>=-.01)break;streak++;}
 return {total_trades:positions.length,winning_trades:positions.filter(p=>p.realized_pnl>.01).length,
  losing_trades:positions.filter(p=>p.realized_pnl<-.01).length,consecutive_losses:streak,
  realized_pnl:positions.reduce((s,p)=>s+p.realized_pnl,0),
  accumulated_trading_fees:positions.reduce((s,p)=>s+p.entry_fee+p.exit_fee,0),
  accumulated_funding_fee:positions.reduce((s,p)=>s+p.funding_fee,0)};
}
