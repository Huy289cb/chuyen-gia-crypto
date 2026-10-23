import {buildNetTradeStatistics,type NetStatisticsPosition} from './net-trade-statistics';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function replayRecordedNetStatistics(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!Number.isFinite(knownAt)||!Number.isFinite(asOf)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),input=obj(d?.input),update=obj(d?.update);
 if(d?.schema!=='net-statistics-update-v1'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||!input||input.order!=='close_time_desc'||!Array.isArray(input.positions)||!update)return unknown('missing_statistics_input');
 const started=typeof d.write_started_at==='string'?Date.parse(d.write_started_at):NaN,applied=typeof d.applied_at==='string'?Date.parse(d.applied_at):NaN;
 if(![started,applied].every(Number.isFinite)||started>applied||applied>knownAt)return unknown('invalid_write_clocks');
 const ids=new Set<string>(),positions:NetStatisticsPosition[]=[];let prior=Infinity;
 for(const value of input.positions){const p=obj(value),close=typeof p?.close_time==='string'?Date.parse(p.close_time):NaN;
  if(!p||typeof p.position_id!=='string'||!p.position_id||ids.has(p.position_id)||!Number.isFinite(close)||close>prior||close>started||![p.realized_pnl,p.entry_fee,p.exit_fee,p.funding_fee].every(Number.isFinite))return unknown('invalid_statistics_rows');
  ids.add(p.position_id);prior=close;positions.push(p as unknown as NetStatisticsPosition);
 }
 const expected=buildNetTradeStatistics(positions);if(!Object.values(expected).every(Number.isFinite))return unknown('nonfinite_statistics');
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>update[k]===v),economic_total_pnl:null,ledger_completeness:'not_established' as const};
}
