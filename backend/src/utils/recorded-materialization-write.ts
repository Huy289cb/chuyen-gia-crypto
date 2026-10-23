/** Replays local write-return contracts, not exchange fill or active protection state. */
export function replayRecordedMaterializationWrite(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_write_receipt');const d=record as Record<string,any>,i=d.input;
 const a=typeof d.write_started_at==='string'?Date.parse(d.write_started_at):NaN,b=typeof d.write_returned_at==='string'?Date.parse(d.write_returned_at):NaN;
 if(d.schema!=='materialization-write-v1'||d.clock_source!=='application_write_return'||![a,b,asOf].every(Number.isFinite)||a>b||b>asOf)return unknown('invalid_write_clock');
 if(!['materialization_attempt_id','order_id','position_id'].every(k=>typeof d[k]==='string'&&d[k])||!Number.isSafeInteger(d.account_id)||d.account_id<=0||!i||typeof i!=='object')return unknown('missing_write_identity');
 if(d.outcome!=='returned'||d.returned_identity_verified!==true)return unknown('unverified_or_failed_write');
 if(d.kind==='execute_pending'){
  if(i.order_id!==d.order_id||i.position_id!==d.position_id||i.status!=='executed'||d.position_link_persisted!=='not_established')return unknown('invalid_pending_contract');
  return {status:'write_contract_replayed' as const,kind:'execute_pending' as const,order_id:d.order_id,position_id:d.position_id,pending_status:'executed',persisted_position_link:'not_established' as const};
 }
 if(d.kind!=='create_position'||i.positionId!==d.position_id||i.accountId!==d.account_id||typeof i.symbol!=='string'||!i.symbol||!['long','short'].includes(i.side))return unknown('invalid_create_identity');
 if(!['entryPrice','sizeQty','sizeUsd','stopLoss','takeProfit','riskUsd','riskPercent','expectedRr'].every(k=>typeof i[k]==='number'&&Number.isFinite(i[k]))||i.entryPrice<=0||i.sizeQty<=0||i.sizeUsd<=0)return unknown('missing_create_financial_inputs');
 return {status:'write_contract_replayed' as const,kind:'create_position' as const,order_id:d.order_id,position_id:d.position_id,account_id:d.account_id,input:i,current_position:'not_established' as const,exchange_fill:'not_established' as const};
}
