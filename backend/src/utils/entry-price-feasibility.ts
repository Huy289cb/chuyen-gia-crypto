import {checkMinSlDistance} from './trade-levels';
/** Preserve production finite checks and branch priority; do not add price constraints here. */
export function evaluateEntryPriceLevels(side:'long'|'short',entry:number,stopLoss:number,takeProfit:number){
 if(![entry,stopLoss,takeProfit].every(Number.isFinite))return {success:false as const,rejectionCode:'missing_data',reason:'Missing or invalid entry / stop_loss / take_profit'};
 let reason:string|null=null;
 if(side==='long'){if(stopLoss>=entry)reason='LONG requires stop_loss < entry';else if(takeProfit<=entry)reason='LONG requires take_profit > entry';}
 else{if(stopLoss<=entry)reason='SHORT requires stop_loss > entry';else if(takeProfit>=entry)reason='SHORT requires take_profit < entry';}
 return reason?{success:false as const,rejectionCode:'invalid_levels',reason}:null;
}
export function evaluateEntryStopFloor(entry:number,stopLoss:number,minPct:number){
 const check=checkMinSlDistance(entry,stopLoss,minPct);
 const block=check.ok?null:{success:false as const,rejectionCode:'stop_floor',reason:`SL distance ${(check.distancePct*100).toFixed(2)}% below min ${(check.minPct*100).toFixed(2)}%`};
 return {check,block};
}
function decode(v:any){if(v?.status==='finite'&&typeof v.value==='number'&&Number.isFinite(v.value))return v.value;if(v?.status==='nonfinite'&&['NaN','Infinity','-Infinity'].includes(v.value))return Number(v.value);return undefined;}
export function replayRecordedEntryPriceFeasibility(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_price_feasibility');const d=record as Record<string,any>,a=Date.parse(d.observed_at),entry=decode(d.entry),stop=decode(d.stop_loss);
 if(d.schema!=='entry-price-feasibility-v1'||typeof d.feasibility_attempt_id!=='string'||!d.feasibility_attempt_id||d.symbol!=='BTC'||d.method_id!=='kim_nghia'||!Number.isFinite(a)||!Number.isFinite(asOf)||a>asOf||!['long','short'].includes(d.side)||entry===undefined||stop===undefined)return unknown('invalid_identity_clock_or_input');
 let expected;
 if(d.stage==='price_levels'){const take=decode(d.take_profit);if(take===undefined)return unknown('missing_take_profit');expected=evaluateEntryPriceLevels(d.side,entry,stop,take);}
 else if(d.stage==='stop_floor'){const floor=decode(d.min_distance_percent);if(floor===undefined)return unknown('missing_floor_policy');expected=evaluateEntryStopFloor(entry,stop,floor);}
 else return unknown('unsupported_stage');
 return {status:'evaluated' as const,expected,matches_recorded:JSON.stringify(expected)===JSON.stringify(d.decision),current_portfolio_state:null,economic_roi:null};
}
