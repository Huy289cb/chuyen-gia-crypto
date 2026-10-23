export const PENDING_ACTIVE_STATUSES = new Set(['pending', 'partially_filled']);
export function isPendingOrderTerminal(status:string|null|undefined):boolean {
 if(!status||PENDING_ACTIVE_STATUSES.has(status))return false;
 if(status==='executed'||status==='executed_historical')return true;
 if(status==='cancelled'||status.startsWith('cancelled_'))return true;
 return status==='expired'||status==='rejected'||status==='failed';
}
/** Occupancy can be released only for the acknowledged zero-fill cancellation. */
export function confirmsZeroFillCancellation(input:{
 symbol:string; exchangeOrderId:string; ack:{orderId?:unknown;symbol?:unknown;status?:unknown;executedQty?:unknown}|null|undefined;
}):boolean {
 const {symbol,exchangeOrderId,ack}=input;
 return !!ack&&String(ack.orderId)===String(exchangeOrderId)&&ack.symbol===`${symbol.toUpperCase()}USDT`&&
 ack.status==='CANCELED'&&ack.executedQty!=null&&Number.isFinite(Number(ack.executedQty))&&Number(ack.executedQty)===0;
}

/** Replay the captured exchange condition; DB claim outcome is a separate event. */
export function replayRecordedCancelAck(record:Record<string,unknown>) {
 if(record.schema!=='pending-cancel-ack-v1'||typeof record.symbol!=='string'||
   typeof record.exchange_order_id!=='string'||typeof record.pending_status!=='string'||
   !Object.hasOwn(record,'ack'))return {status:'unknown' as const,reason:'missing_cancel_ack_inputs'};
 if(!PENDING_ACTIVE_STATUSES.has(record.pending_status))return {status:'unknown' as const,reason:'not_active_at_cancel'};
 const id=Number(record.exchange_order_id);
 if(!Number.isSafeInteger(id)||id<=0)return {status:'unknown' as const,reason:'invalid_exchange_identity'};
 if(record.ack!==null&&(typeof record.ack!=='object'||Array.isArray(record.ack)))return {status:'unknown' as const,reason:'invalid_ack_shape'};
 const confirmed=confirmsZeroFillCancellation({symbol:record.symbol,exchangeOrderId:record.exchange_order_id,
  ack:record.ack as Parameters<typeof confirmsZeroFillCancellation>[0]['ack']});
 return {status:'evaluated' as const,confirmed_zero_fill:confirmed,
  occupancy_release:'requires_separate_db_claim' as const};
}

export function replayRecordedCancelClaim(ack:Record<string,unknown>,claim:Record<string,unknown>) {
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(claim.schema!=='pending-cancel-claim-v1'||typeof ack.cancel_attempt_id!=='string'||
   ack.cancel_attempt_id!==claim.cancel_attempt_id||typeof ack.order_id!=='string'||ack.order_id!==claim.order_id)
   return unknown('unlinked_cancel_claim');
 const evaluated=replayRecordedCancelAck(ack);
 if(evaluated.status!=='evaluated')return evaluated;
 if(!evaluated.confirmed_zero_fill)return unknown('claim_without_confirmed_zero_fill');
 if(![0,1].includes(claim.claimed_count as number)||typeof claim.target_status!=='string'||
   !['cancelled_ttl_expired','cancelled_price_drift','cancelled_manual','cancelled_ai_review'].includes(claim.target_status))
   return unknown('invalid_claim_result');
 return {status:'evaluated' as const,occupancy_released:claim.claimed_count===1,
   resulting_status:claim.claimed_count===1?claim.target_status:null};
}
