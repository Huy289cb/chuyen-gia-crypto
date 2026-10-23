/** Shared evidence checks around sealing the unfilled remainder of an entry. */
export function validPartialFillEvidence(input:{orderId:number;symbol:string;remoteOrderId:unknown;
 remoteSymbol:unknown;executedQty:number;minimumObservedQty:number;requirePositive:boolean}):boolean {
 return Number.isSafeInteger(input.orderId)&&input.orderId>0&&Number(input.remoteOrderId)===input.orderId&&
 input.remoteSymbol===input.symbol&&Number.isFinite(input.executedQty)&&
 (input.requirePositive?input.executedQty>0:input.executedQty>=input.minimumObservedQty);
}
export function sealedEntryStatus(status:string):boolean {
 return ['FILLED','CANCELED','EXPIRED','REJECTED'].includes(status);
}
/** A cancelled remainder with positive filled quantity still represents a position. */
export function entryHasMaterializableFill(status:string,executedQty:number):boolean {
 return status==='FILLED'||(['CANCELED','EXPIRED','REJECTED'].includes(status)&&Number.isFinite(executedQty)&&executedQty>0);
}

export function replayRecordedPartialRequery(record:Record<string,unknown>,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(record.schema!=='partial-fill-requery-v1'||typeof record.exchange_order_id!=='string'||typeof record.symbol!=='string'||
  !Number.isFinite(asOf)||typeof record.initial_known_at!=='number'||typeof record.final_known_at!=='number'||
  !Number.isFinite(record.initial_known_at)||!Number.isFinite(record.final_known_at)||
  record.initial_known_at>record.final_known_at||record.final_known_at>asOf)return unknown('missing_or_future_partial_queries');
 const first=record.initial as Record<string,unknown>|undefined,last=record.final as Record<string,unknown>|undefined;
 if(!first||!last||typeof first.executedQty!=='number'||typeof last.executedQty!=='number'||
  typeof first.status!=='string'||typeof last.status!=='string')return unknown('missing_partial_query_fields');
 if(first.status!=='PARTIALLY_FILLED')return unknown('not_partial_recovery_input');
 const orderId=Number(record.exchange_order_id),symbol=record.symbol;
 if(!validPartialFillEvidence({orderId,symbol,remoteOrderId:first.orderId,remoteSymbol:first.symbol,
  executedQty:first.executedQty,minimumObservedQty:0,requirePositive:true}))return {status:'evaluated' as const,next_action:'invalid_initial' as const};
 if(!validPartialFillEvidence({orderId,symbol,remoteOrderId:last.orderId,remoteSymbol:last.symbol,
  executedQty:last.executedQty,minimumObservedQty:first.executedQty,requirePositive:false}))return {status:'evaluated' as const,next_action:'invalid_final' as const};
 return {status:'evaluated' as const,next_action:sealedEntryStatus(last.status)?'materialization_checks':'keep_pending',
  observed_quantity:last.executedQty};
}
