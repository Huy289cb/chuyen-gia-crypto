import {randomUUID} from 'node:crypto';
export async function observePendingCreation<T>(input:Record<string,unknown>,write:()=>Promise<T>,publish:(data:Record<string,unknown>)=>Promise<unknown>):Promise<T>{
 const attempt_id=randomUUID(),write_started_at=new Date().toISOString();const emit=(outcome:string,verified:boolean)=>{const data={schema:'pending-create-write-v1',attempt_id,input,write_started_at,write_returned_at:new Date().toISOString(),outcome,returned_identity_verified:verified,clock_source:'application_write_return'};try{void publish(data).catch(()=>console.warn('[PendingCreate] persistence unavailable'));}catch{console.warn('[PendingCreate] persistence unavailable');}};
 let result:T;try{result=await write();}catch(error){emit('threw',false);throw error;}const row=result as Record<string,unknown>|null|undefined;emit('returned',!!row&&row.order_id===input.orderId&&row.account_id===input.accountId&&row.binance_order_id===input.binanceOrderId);return result;
}
export function replayPendingCreation(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});if(!record||typeof record!=='object')return unknown('missing_receipt');const d=record as Record<string,any>,i=d.input,a=Date.parse(d.write_started_at),b=Date.parse(d.write_returned_at);
 if(d.schema!=='pending-create-write-v1'||d.clock_source!=='application_write_return'||!Number.isFinite(asOf)||!Number.isFinite(a)||!Number.isFinite(b)||a>b||b>asOf||typeof d.attempt_id!=='string'||!d.attempt_id)return unknown('invalid_write_clock_identity');
 if(d.outcome!=='returned'||d.returned_identity_verified!==true||!i)return unknown('unverified_or_failed_creation');
 if(typeof i.orderId!=='string'||!i.orderId||typeof i.binanceOrderId!=='string'||!i.binanceOrderId||!Number.isSafeInteger(i.accountId)||i.accountId<=0||i.symbol!=='BTC'||!['long','short'].includes(i.side))return unknown('invalid_pending_identity');
 if(!['entryPrice','stopLoss','takeProfit','sizeUsd','sizeQty','riskUsd','riskPercent','expectedRr'].every(k=>typeof i[k]==='number'&&Number.isFinite(i[k]))||i.entryPrice<=0||i.sizeQty<=0||i.sizeUsd<=0)return unknown('missing_pending_financial_input');
 return {status:'pending_create_contract_replayed' as const,account_id:i.accountId,order_id:i.orderId,input:i,exchange_order_state:'not_established' as const};
}
