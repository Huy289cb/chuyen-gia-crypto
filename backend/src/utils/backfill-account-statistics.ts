import {isInternalCloseReason} from './bookkeeping-close';
export function buildBackfillAccountStatistics(rows: readonly {realized_pnl: unknown;close_reason: string|null}[]) {
  const counted = rows.filter(p=>!isInternalCloseReason(p.close_reason));
  let wins=0,losses=0,totalRealized=0;
  for(const p of counted){const pnl=Number(p.realized_pnl)||0;totalRealized+=pnl;
    if(pnl>0.01)wins++;else if(pnl< -0.01)losses++;}
  return {statistics:{total_trades:counted.length,winning_trades:wins,losing_trades:losses},totalRealized};
}
