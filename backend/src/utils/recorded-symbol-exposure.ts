import {evaluateSymbolExposure} from './symbol-exposure-evaluation';
/** Never allow production fallback arithmetic to turn absent replay evidence into zero. */
export function replayRecordedSymbolExposure(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_exposure_read');
 const d=record as Record<string,any>,a=Date.parse(d.read_started_at),b=Date.parse(d.read_returned_at),c=Date.parse(d.observed_at);
 if(d.schema!=='symbol-exposure-read-v1'||!Number.isFinite(asOf)||!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||a>b||b>c||c>asOf)return unknown('invalid_exposure_read_clock');
 if(typeof d.read_id!=='string'||!d.read_id||!Number.isSafeInteger(d.account_id)||d.account_id<=0||d.symbol!=='BTC'||d.method_id!=='kim_nghia'||!Array.isArray(d.open_positions)||!Array.isArray(d.pending_orders)||typeof d.max_exposure_usd!=='number'||!Number.isFinite(d.max_exposure_usd)||d.max_exposure_usd<0)return unknown('incomplete_scope_or_cap');
 const ids=new Set<string>();for(const [rows,key]of [[d.open_positions,'position_id'],[d.pending_orders,'order_id']] as const)for(const p of rows){if(!p||typeof p[key]!=='string'||!p[key]||ids.has(key+':'+p[key])||typeof p.side!=='string'||!['long','short'].includes(p.side.toLowerCase())||typeof p.size_usd!=='number'||!Number.isFinite(p.size_usd))return unknown('incomplete_or_duplicate_exposure_rows');ids.add(key+':'+p[key]);}
 const expected=evaluateSymbolExposure(d.open_positions,d.pending_orders,d.max_exposure_usd);if(![expected.openUsd,expected.pendingUsd,expected.totalUsd,expected.remainingUsd].every(Number.isFinite))return unknown('nonfinite_exposure_sum');
 return {status:'evaluated' as const,expected,read_scope:'supplied_repository_read_contract_only' as const,current_portfolio_state:null,economic_roi:null};
}
