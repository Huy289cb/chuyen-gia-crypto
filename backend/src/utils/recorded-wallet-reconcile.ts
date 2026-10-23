import {buildWalletReconcileUpdate,type ReconcilePositionCosts} from './wallet-reconcile-update';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function replayRecordedWalletReconcile(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!Number.isFinite(knownAt)||!Number.isFinite(asOf))return unknown('missing_knowledge_time');
 if(knownAt>asOf)return unknown('not_known_at_cutoff');
 const d=obj(record),input=obj(d?.input),snapshot=obj(input?.snapshot),update=obj(d?.update);
 if(d?.schema!=='wallet-reconcile-update-v1'||!input||!snapshot||!update||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0)return unknown('missing_reconcile_identity');
 if(!Number.isFinite(input.starting_balance)||![snapshot.walletBalance,snapshot.equity,snapshot.unrealizedPnl].every(Number.isFinite)||!Array.isArray(input.positions))return unknown('missing_reconcile_input');
 const positions:ReconcilePositionCosts[]=[];
 for(const v of input.positions){const p=obj(v);if(!p||(p.realized_pnl!==null&&!Number.isFinite(p.realized_pnl))||![p.entry_fee,p.exit_fee,p.funding_fee].every(Number.isFinite))return unknown('invalid_position_costs');positions.push(p as unknown as ReconcilePositionCosts);}
 const updated=typeof update.updated_at==='string'?Date.parse(update.updated_at):NaN,applied=typeof d.applied_at==='string'?Date.parse(d.applied_at):NaN;
 if(![updated,applied].every(Number.isFinite)||updated>applied||applied>knownAt)return unknown('invalid_reconcile_clocks');
 const expected=buildWalletReconcileUpdate(input.starting_balance as number,snapshot as unknown as {walletBalance:number;equity:number;unrealizedPnl:number},positions,new Date(updated));
 if(!Object.values(expected).every(v=>v instanceof Date||Number.isFinite(v)))return unknown('nonfinite_reconcile_result');
 const serialized={...expected,updated_at:expected.updated_at.toISOString()};
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:serialized,matches_recorded:Object.keys(update).length===Object.keys(serialized).length&&Object.entries(serialized).every(([k,v])=>update[k]===v),economic_total_pnl:null,ledger_completeness:'not_established' as const};
}
