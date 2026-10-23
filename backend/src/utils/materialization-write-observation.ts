export interface MaterializationWriteIdentity{materialization_attempt_id:string;order_id:string;position_id:string;account_id:number;}
/** Read-return receipt, never a commit-clock/transaction atomicity claim. Publish cannot replace write outcome. */
export async function observeMaterializationWrite<T>(kind:'create_position'|'execute_pending',identity:MaterializationWriteIdentity,input:Record<string,unknown>,write:()=>Promise<T>,publish:(record:Record<string,unknown>)=>Promise<unknown>):Promise<T>{
 const write_started_at=new Date().toISOString();
 const emit=(outcome:'returned'|'threw',verified:boolean)=>{const record={schema:'materialization-write-v1',...identity,kind,input,write_started_at,write_returned_at:new Date().toISOString(),clock_source:'application_write_return',outcome,returned_identity_verified:verified,position_link_persisted:kind==='execute_pending'?'not_established':'not_applicable'};try{void publish(record).catch(()=>console.warn('[MaterializationWrite] persistence unavailable'));}catch{console.warn('[MaterializationWrite] persistence unavailable');}};
 let value:T;try{value=await write();}catch(error){emit('threw',false);throw error;}
 const row=value as Record<string,unknown>|null|undefined;
 const verified=kind==='execute_pending'?input.order_id===identity.order_id&&input.position_id===identity.position_id&&input.status==='executed':!!row&&row.position_id===identity.position_id&&row.account_id===identity.account_id;
 emit('returned',verified);return value;
}
