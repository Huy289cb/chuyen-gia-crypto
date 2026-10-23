import {evaluatePendingCancelCooldown,evaluatePostCloseCooldown} from './entry-history-cooldown-evaluation';
export function replayRecordedEntryHistoryCooldown(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_history_read');
 const d=record as Record<string,any>,a=Date.parse(d.read_started_at),b=Date.parse(d.read_returned_at),since=Date.parse(d.query_since);
 if(d.schema!=='entry-history-cooldown-read-v1'||typeof d.read_id!=='string'||!d.read_id||d.symbol!=='BTC'||![a,b,since,d.decision_at,asOf].every(Number.isFinite)||since>a||a>b||b>d.decision_at||d.decision_at>asOf||typeof d.cooldown_min!=='number'||!Number.isFinite(d.cooldown_min)||d.cooldown_min<=0)return unknown('invalid_scope_clock_or_window');
 let decision:string|null;
 if(d.kind==='pending_cancel'){
  if(d.query_limit!==20||!Array.isArray(d.events)||d.events.length>20)return unknown('invalid_cancel_query_contract');
  let previous=Infinity;
  for(const e of d.events){const stamp=Date.parse(e?.timestamp);if(!Number.isFinite(stamp)||stamp<since||stamp>b||stamp>previous||!(e.event_data===null||typeof e.event_data==='string'))return unknown('invalid_cancel_history');previous=stamp;}
  decision=evaluatePendingCancelCooldown(d.symbol,d.cooldown_min,d.events.map((e:any)=>({...e,timestamp:new Date(e.timestamp)})),()=>d.decision_at);
 }else if(d.kind==='post_close'){
  if(d.method_id!=='kim_nghia')return unknown('invalid_close_scope');
  if(d.recent===null)decision=null;
  else{const p=d.recent,stamp=Date.parse(p?.close_time);if(!p||typeof p.position_id!=='string'||!p.position_id||!['long','short'].includes(p.side)||!Number.isFinite(stamp)||stamp<since||stamp>b||!(p.realized_pnl===null||typeof p.realized_pnl==='number'&&Number.isFinite(p.realized_pnl)))return unknown('invalid_close_history');decision=evaluatePostCloseCooldown({close_time:new Date(p.close_time),side:p.side},(p.realized_pnl??0)<-.01,d.cooldown_min,()=>d.decision_at);}
 }else return unknown('unsupported_history_kind');
 return {status:'evaluated' as const,decision,history_scope:'supplied_filtered_repository_read_only' as const,current_portfolio_state:null,economic_roi:null};
}
