import {evaluateMaterializationPrice,evaluateMaterializationExposureQuantity} from './fill-materialization-gate';
export function encodeMaterializationNumber(value:number){return Number.isFinite(value)?{status:'finite',value}:{status:'nonfinite',value:String(value)};}
function decode(input:any){if(input?.status==='finite'&&typeof input.value==='number'&&Number.isFinite(input.value))return input.value;if(input?.status==='nonfinite'&&['NaN','Infinity','-Infinity'].includes(input.value))return Number(input.value);return undefined;}
export function replayRecordedMaterializationGate(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_gate');const d=record as Record<string,any>,i=d.input,t=typeof d.observed_at==='string'?Date.parse(d.observed_at):NaN;
 if(d.schema!=='materialization-gate-v1'||!Number.isFinite(asOf)||!Number.isFinite(t)||t>asOf||typeof d.materialization_attempt_id!=='string'||!d.materialization_attempt_id||typeof d.order_id!=='string'||!d.order_id||!i)return unknown('invalid_gate_identity_clock');
 let expected;if(d.stage==='price'){const price=decode(i.avg_price);if(price===undefined)return unknown('missing_price_encoding');expected=evaluateMaterializationPrice(price);}
 else if(d.stage==='exposure_quantity'){const a=Date.parse(String(i.read_started_at)),b=Date.parse(String(i.read_returned_at)),q=decode(i.executed_qty);if(q===undefined||typeof i.exposure_present!=='boolean'||!Number.isFinite(a)||!Number.isFinite(b)||a>b||b>t)return unknown('invalid_exposure_quantity_input');expected=evaluateMaterializationExposureQuantity(i.exposure_present,q);}
 else return unknown('unsupported_gate_stage');
 return {status:'evaluated' as const,matches_recorded:JSON.stringify(expected)===JSON.stringify(d.decision),expected_decision:expected,exchange_query_coverage:'not_established' as const};
}
