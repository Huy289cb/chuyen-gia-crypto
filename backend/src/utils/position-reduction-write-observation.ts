export interface ReductionWriteIdentity { reduction_attempt_id:string; account_id:number; position_id:string; }
/** Observes a local write only. A close response is not exchange fill verification. */
export async function observePositionReductionWrite<T>(identity:ReductionWriteIdentity,before:Record<string,unknown>,input:Record<string,unknown>,close_response:Record<string,unknown>,write:()=>Promise<T>,publish:(data:Record<string,unknown>)=>Promise<unknown>):Promise<T>{
 const write_started_at=new Date().toISOString();
 const emit=(outcome:string)=>{const data={schema:'position-reduction-write-v1',...identity,before,input,close_response,write_started_at,write_returned_at:new Date().toISOString(),outcome,clock_source:'application_write_return',exchange_fill_verification:'not_established'};try{void publish(data).catch(()=>console.warn('[PositionReductionWrite] persistence unavailable'));}catch{console.warn('[PositionReductionWrite] persistence unavailable');}};
 let value:T;try{value=await write();}catch(error){emit('threw');throw error;}emit('returned');return value;
}
export function replayPositionReductionWrite(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_receipt');
 const d=record as Record<string,any>,a=Date.parse(d.write_started_at),b=Date.parse(d.write_returned_at),p=d.before,i=d.input;
 if(d.schema!=='position-reduction-write-v1'||d.clock_source!=='application_write_return'||!Number.isFinite(asOf)||!Number.isFinite(a)||!Number.isFinite(b)||a>b||b>asOf)return unknown('invalid_clock');
 if(typeof d.reduction_attempt_id!=='string'||!d.reduction_attempt_id||typeof d.position_id!=='string'||!d.position_id||!Number.isSafeInteger(d.account_id)||d.account_id<=0||d.outcome!=='returned'||!p||!i||d.close_response?.ok!==true)return unknown('invalid_identity_or_failed_write');
 if(!['long','short'].includes(p.side)||p.status!=='open'||!['size_qty','size_usd','partial_closed'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k]))||p.size_qty===0||p.size_usd<0)return unknown('invalid_pre_state');
 if(!['size_qty','size_usd','current_price','partial_closed'].every(k=>typeof i[k]==='number'&&Number.isFinite(i[k]))||i.size_usd<0||i.current_price<=0||i.partial_closed!==1||Math.abs(i.size_qty)>Math.abs(p.size_qty)||p.side==='short'&&i.size_qty>0||p.side==='long'&&i.size_qty<0)return unknown('invalid_reduction_update');
 // Preserve the exact production write; do not recompute or infer realized P&L from local size changes.
 return {status:'local_reduction_contract_replayed' as const,account_id:d.account_id,position_id:d.position_id,attempt_id:d.reduction_attempt_id,before:p,update:{size_qty:i.size_qty,size_usd:i.size_usd,current_price:i.current_price,partial_closed:i.partial_closed},exchange_fill_verification:'not_established' as const,economic_roi:null};
}
