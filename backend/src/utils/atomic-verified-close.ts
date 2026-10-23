import {buildCloseAccountUpdate} from './close-account-update';
interface CloseInput {positionId:string;accountId:number;closePrice:number;closeReason:string;realizedPnl:number;entryFee:number;exitFee:number;fundingFee:number;walletAuthoritative:boolean}
interface Database {$transaction<T>(work:(tx:any)=>Promise<T>):Promise<T>}
/** Claim and accounting share one commit; any failure rolls back the position claim. */
export async function commitAtomicVerifiedClose(db:Database,input:CloseInput){
 if(!input.positionId||!Number.isSafeInteger(input.accountId)||input.accountId<=0||!input.closeReason||![input.closePrice,input.realizedPnl,input.entryFee,input.exitFee,input.fundingFee].every(Number.isFinite)||input.closePrice<=0||input.entryFee<0||input.exitFee<0||typeof input.walletAuthoritative!=='boolean')throw Error('invalid_verified_close_input');
 const started_at=new Date().toISOString();
 const result=await db.$transaction(async tx=>{
  const at=new Date();
  const positionUpdate={status:'closed',close_price:input.closePrice,close_time:at,close_reason:input.closeReason,current_price:input.closePrice,realized_pnl:input.realizedPnl,entry_fee:input.entryFee,exit_fee:input.exitFee,funding_fee:input.fundingFee,unrealized_pnl:0};
  const claim=await tx.testnetPosition.updateMany({where:{position_id:input.positionId,account_id:input.accountId,status:{in:['open','reconciliation_failed_not_on_binance']}},data:positionUpdate});
  if(claim.count===0)return {status:'not_claimed' as const};
  if(claim.count!==1)throw Error('ambiguous_position_claim');
  const account=await tx.testnetAccount.findUnique({where:{id:input.accountId}});
  if(!account||!Number.isFinite(account.current_balance))throw Error('missing_close_account');
  const accountUpdate=buildCloseAccountUpdate({balance:account.current_balance,realizedPnl:input.realizedPnl,lastTradeTime:at,updatedAt:at,walletAuthoritative:input.walletAuthoritative});
  await tx.testnetAccount.update({where:{id:input.accountId},data:accountUpdate});
  return {status:'committed' as const,positionUpdate,accountUpdate,accountBalanceBefore:account.current_balance};
 });
 if(result.status!=='committed')return result;
 return {...result,receipt:JSON.parse(JSON.stringify({schema:'atomic-verified-close-v1',position_id:input.positionId,account_id:input.accountId,input,position_update:result.positionUpdate,account_update:result.accountUpdate,account_balance_before:result.accountBalanceBefore,transaction_started_at:started_at,committed_return_at:new Date().toISOString(),clock_source:'transaction_return'}))};
}
/** Recompute the supplied commit contract, without asserting journal completeness. */
export function replayAtomicVerifiedClose(record:unknown,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!record||typeof record!=='object'||Array.isArray(record))return unknown('missing_atomic_close');
 const d=record as Record<string,any>,i=d.input,start=Date.parse(d.transaction_started_at),end=Date.parse(d.committed_return_at),at=Date.parse(d.position_update?.close_time);
 if(d.schema!=='atomic-verified-close-v1'||d.clock_source!=='transaction_return'||![start,end,at,asOf].every(Number.isFinite)||start>at||at>end||end>asOf)return unknown('invalid_atomic_close_clock');
 if(!i||typeof i.positionId!=='string'||!i.positionId||d.position_id!==i.positionId||d.account_id!==i.accountId||!Number.isSafeInteger(i.accountId)||i.accountId<=0||typeof i.closeReason!=='string'||!i.closeReason||typeof i.walletAuthoritative!=='boolean'||![i.closePrice,i.realizedPnl,i.entryFee,i.exitFee,i.fundingFee,d.account_balance_before].every(v=>typeof v==='number'&&Number.isFinite(v))||i.closePrice<=0||i.entryFee<0||i.exitFee<0)return unknown('invalid_atomic_close_input');
 const expectedPosition={status:'closed',close_price:i.closePrice,close_time:new Date(at).toISOString(),close_reason:i.closeReason,current_price:i.closePrice,realized_pnl:i.realizedPnl,entry_fee:i.entryFee,exit_fee:i.exitFee,funding_fee:i.fundingFee,unrealized_pnl:0};
 const expectedAccount=JSON.parse(JSON.stringify(buildCloseAccountUpdate({balance:d.account_balance_before,realizedPnl:i.realizedPnl,lastTradeTime:new Date(at),updatedAt:new Date(at),walletAuthoritative:i.walletAuthoritative})));
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const matches=JSON.stringify(canonical(expectedPosition))===JSON.stringify(canonical(d.position_update))&&JSON.stringify(canonical(expectedAccount))===JSON.stringify(canonical(d.account_update));
 return {status:'evaluated' as const,matches_recorded:matches,account_id:i.accountId,position_id:i.positionId,expected_position_update:expectedPosition,expected_update:expectedAccount,write_started_at:d.transaction_started_at,write_returned_at:d.committed_return_at,economic_roi:null};
}
