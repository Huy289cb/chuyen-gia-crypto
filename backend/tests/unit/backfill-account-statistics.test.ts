import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildBackfillAccountStatistics} from '../../src/utils/backfill-account-statistics';
import {isInternalCloseReason} from '../../src/utils/bookkeeping-close';
const deployed=readFileSync('dist/services/position-pnl-backfill.service.js','utf8');
const start=deployed.indexOf('    let wins = 0;',deployed.indexOf('async function recomputeTestnetAccountTradeStats'));
const end=deployed.indexOf('    await prisma_1.prisma.testnetAccount.update({',start);
if(start<0||end<=start)throw Error('missing_deployed_statistics_region');
const legacy=new Function('closed','bookkeeping_close_1',deployed.slice(start,end)+'return {statistics:{total_trades:counted.length,winning_trades:wins,losing_trades:losses},totalRealized};');
it('matches exact deployed null/string/near-zero and internal-reason statistics',()=>{
 for(const reason of [null,'manual','reconciliation_fill','merged_into_p1']){
  const rows=[-1,-.01,-.005,0,.005,.01,1,null,'2','invalid'].map(pnl=>({realized_pnl:pnl,close_reason:reason}));
  expect(buildBackfillAccountStatistics(rows)).toEqual(legacy(rows,{isInternalCloseReason}));
 }
 expect(buildBackfillAccountStatistics([])).toEqual(legacy([],{isInternalCloseReason}));
});
