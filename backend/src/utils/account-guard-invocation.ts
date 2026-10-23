import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
export interface GuardInvocation { guard_invocation_id:string; guard_account_id:number; guard_symbol:string|null; }
const scope=new AsyncLocalStorage<GuardInvocation>();
export const currentGuardInvocation=()=>scope.getStore();
type Decision={allowed:boolean;reason:string;remainingDailyRiskUsd?:number};
type Emit=(stage:string,data:Record<string,unknown>)=>Promise<void>;
/** Scope each actual guard call, including awaited circuit stages. Journal failure never changes its result. */
export async function runGuardInvocation<T extends Decision>(accountId:number,symbol:string|undefined,fn:()=>Promise<T>,emit:Emit):Promise<T>{
 const identity:GuardInvocation={guard_invocation_id:randomUUID(),guard_account_id:accountId,guard_symbol:symbol??null};
 return scope.run(identity,async()=>{
  const write=async(stage:string,data:Record<string,unknown>)=>{try{await emit(stage,{...identity,account_id:accountId,...data});}catch{console.warn('[AccountGuardInvocation] persistence unavailable');}};
  await write('account_guard_invocation_started',{invocation_schema:'account-guard-invocation-v1',started_at:new Date().toISOString(),exchange_loss_streak_required:process.env.BINANCE_ENABLED==='true'&&!!symbol});
  let result:T;
  try{result=await fn();}catch(error){
   await write('account_guard_invocation_finished',{invocation_schema:'account-guard-invocation-v1',finished_at:new Date().toISOString(),outcome:'threw',decision:null});
   throw error;
  }
  await write('account_guard_invocation_finished',{invocation_schema:'account-guard-invocation-v1',finished_at:new Date().toISOString(),outcome:'returned',decision:result,
   financial_output_status:result.remainingDailyRiskUsd===undefined?'absent':Number.isFinite(result.remainingDailyRiskUsd)?'finite':'nonfinite'});
  return result;
 });
}
