import {replayAtomicVerifiedClose} from './atomic-verified-close';
import {observedAccountFieldConvergence} from './account-field-convergence';
import {replayRecordedManualClose} from './recorded-manual-close';
import {replayRecordedBackfillStatistics} from './recorded-backfill-statistics';
import {replayRecordedStartingBalance} from './recorded-starting-balance';
import {replayRecordedPrecisionReset} from './recorded-precision-reset';
import {replayRecordedAccountCircuitMutation} from './recorded-account-circuit-mutation';
import {replayRecordedAccountCooldownSet} from './recorded-account-cooldown-set';
import {replayRecordedAccountGuardMutation} from './recorded-account-guard-mutation';
import {replayAccountWalletJournal} from './recorded-account-wallet';
import {replayRecordedWalletReconcile} from './recorded-wallet-reconcile';
import {replayRecordedNetStatistics} from './recorded-net-statistics';
import {replayRecordedCloseAccount} from './recorded-close-account';
import {replayRecordedAccountState} from './recorded-account-state';
interface Event {id:number|string;position_id?:string;event_type:string;timestamp:string;event_data:unknown}
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Observed overwrite ordering only; incomplete coverage never becomes a portfolio ledger. */
export function replayAccountOverwriteTimeline(events:readonly Event[],asOf:number,snapshot?:unknown){
 if(!Number.isFinite(asOf))throw Error('invalid_account_timeline_cutoff');
 const wallet=replayAccountWalletJournal(events,asOf),unknown:{event_id:number|string;reason:string}[]=[];
 const writes:{event_id:number|string;account_id:number;start:number;end:number;update:Record<string,unknown>}[]=[];
 const eligible=events.filter(e=>['atomic_verified_close_committed','account_wallet_sync_observed','account_wallet_reconcile_applied','account_net_statistics_applied','close_account_update_applied','account_guard_mutation_applied','account_cooldown_set_applied','account_circuit_mutation_applied','account_precision_reset_applied','account_starting_balance_sync_applied','account_backfill_statistics_applied','account_manual_close_applied'].includes(e.event_type)&&!(Date.parse(e.timestamp)>asOf));
 const closePositions=new Map<string,number>();
 for(const e of eligible)if(['close_account_update_applied','atomic_verified_close_committed'].includes(e.event_type)&&e.position_id)closePositions.set(e.position_id,(closePositions.get(e.position_id)??0)+1);
 const ids=new Map<string,number>(),attempts=new Map<string,number>();
 const attemptOf=(e:Event)=>{const d=obj(e.event_data);return e.event_type==='account_manual_close_applied'?d?.manual_close_attempt_id:e.event_type==='account_backfill_statistics_applied'?d?.backfill_attempt_id:e.event_type==='account_starting_balance_sync_applied'?d?.capital_attempt_id:e.event_type==='account_precision_reset_applied'?d?.precision_attempt_id:e.event_type==='account_circuit_mutation_applied'?d?.circuit_attempt_id:e.event_type==='account_cooldown_set_applied'?d?.cooldown_attempt_id:e.event_type==='account_guard_mutation_applied'?d?.mutation_attempt_id:e.event_type==='account_net_statistics_applied'?d?.statistics_attempt_id:d?.reconcile_attempt_id;};
 for(const e of eligible){ids.set(String(e.id),(ids.get(String(e.id))??0)+1);const attempt=attemptOf(e);if(typeof attempt==='string')attempts.set(attempt,(attempts.get(attempt)??0)+1);}
 for(const e of eligible){
  if(ids.get(String(e.id))!==1){unknown.push({event_id:e.id,reason:'duplicate_event_identity'});continue;}
  const d=obj(e.event_data);
  if(e.event_type==='atomic_verified_close_committed'){
   const r=replayAtomicVerifiedClose(d,Math.min(asOf,Date.parse(e.timestamp)));
   if(r.status!=='evaluated'||!r.matches_recorded||e.position_id!==r.position_id||closePositions.get(r.position_id)!==1){unknown.push({event_id:e.id,reason:'unverified_or_duplicate_atomic_account_close'});continue;}
   writes.push({event_id:e.id,account_id:r.account_id,start:Date.parse(r.write_started_at),end:Date.parse(r.write_returned_at),update:r.expected_update});continue;
  }
  const r=e.event_type==='account_manual_close_applied'?replayRecordedManualClose(d,Date.parse(e.timestamp),asOf):e.event_type==='account_backfill_statistics_applied'?replayRecordedBackfillStatistics(d,Date.parse(e.timestamp),asOf):e.event_type==='account_starting_balance_sync_applied'?replayRecordedStartingBalance(d,Date.parse(e.timestamp),asOf):e.event_type==='account_precision_reset_applied'?replayRecordedPrecisionReset(d,Date.parse(e.timestamp),asOf):e.event_type==='account_circuit_mutation_applied'?replayRecordedAccountCircuitMutation(d,Date.parse(e.timestamp),asOf):e.event_type==='account_cooldown_set_applied'?replayRecordedAccountCooldownSet(d,Date.parse(e.timestamp),asOf):e.event_type==='account_wallet_sync_observed'?wallet.rows.find(row=>row.event_id===e.id):e.event_type==='account_guard_mutation_applied'?replayRecordedAccountGuardMutation(d,Date.parse(e.timestamp),asOf):e.event_type==='close_account_update_applied'?replayRecordedCloseAccount(d,Date.parse(e.timestamp),asOf):e.event_type==='account_net_statistics_applied'?replayRecordedNetStatistics(d,Date.parse(e.timestamp),asOf):replayRecordedWalletReconcile(d,Date.parse(e.timestamp),asOf);
  if(!r||r.status!=='evaluated'||!r.matches_recorded){unknown.push({event_id:e.id,reason:'unverified_overwrite'});continue;}
  const attempt=attemptOf(e);
  if(e.event_type==='close_account_update_applied'){
   if(!e.position_id||closePositions.get(e.position_id)!==1||!('application_ordering' in r)||r.application_ordering!=='db_return_observed'){unknown.push({event_id:e.id,reason:'missing_or_ambiguous_close_application'});continue;}
  }else if(e.event_type!=='account_wallet_sync_observed'&&(typeof attempt!=='string'||!attempt||attempts.get(attempt)!==1)){unknown.push({event_id:e.id,reason:'missing_or_ambiguous_account_attempt'});continue;}
  const update=obj(r.expected_update)!;
  writes.push({event_id:e.id,account_id:Number(r.account_id),start:Date.parse(String(['account_net_statistics_applied','account_guard_mutation_applied','account_cooldown_set_applied','account_circuit_mutation_applied','account_precision_reset_applied','account_starting_balance_sync_applied','account_backfill_statistics_applied','account_manual_close_applied'].includes(e.event_type)?d?.write_started_at:update.updated_at)),end:Date.parse(String(d?.applied_at)),update});
 }
 const seed=snapshot===undefined?null:replayRecordedAccountState(snapshot,asOf);
 const accountIds=[...new Set([...writes.map(w=>w.account_id),...(seed?.status==='observed'?[Number(seed.account_id)]:[])])];
 const accounts=accountIds.map(account_id=>{
  const useSeed=seed?.status==='observed'&&seed.account_id===account_id;
  const seedKnown=useSeed?Date.parse(seed.seed_not_before):NaN,seedStarted=useSeed?Date.parse(String(obj(snapshot)?.read_started_at)):NaN;
  const all=writes.filter(w=>w.account_id===account_id);
  const boundary=useSeed?all.filter(w=>w.end>=seedStarted&&w.start<=seedKnown):[];
  const rows=all.filter(w=>!useSeed||w.start>seedKnown).sort((a,b)=>a.start-b.start);
  const ambiguous=boundary.length>0||rows.some((r,i)=>i>0&&rows.slice(0,i).some(p=>p.end>=r.start));
  const fields:Record<string,unknown>=useSeed?{...seed.local_account_state}:{},unresolved=new Set<string>();
  if(!ambiguous)for(const row of rows)for(const [key,value]of Object.entries(row.update)){
   const operation=obj(value);
   if(operation){
    if(Object.keys(operation).length===1&&Number.isFinite(operation.increment)&&Number.isFinite(fields[key])){
     const next=Number(fields[key])+Number(operation.increment);
     if(Number.isFinite(next)){fields[key]=next;unresolved.delete(key);continue;}
    }
    delete fields[key];unresolved.add(key);
   }else{fields[key]=value;unresolved.delete(key);}
  }
  return {account_id,status:ambiguous?'unknown' as const:'observed_sequence' as const,reason:boundary.length?'write_overlaps_snapshot_boundary':ambiguous?'overlapping_or_coarse_write_clocks':null,
   seed_applied:useSeed,seed_not_before:useSeed?seed.seed_not_before:null,excluded_pre_seed_writes:useSeed?all.filter(w=>w.end<seedStarted).length:0,
   snapshot_boundary_event_ids:boundary.map(w=>w.event_id),
   observed_field_convergence:boundary.length?null:observedAccountFieldConvergence(rows),
   writes:rows.map(({start,end,...r})=>({...r,write_started_at:new Date(start).toISOString(),write_returned_at:new Date(end).toISOString()})),
   latest_observed_overwrite:ambiguous?null:rows.filter(r=>Object.hasOwn(r.update,'current_balance')).at(-1)?.update??null,
   latest_observed_fields:ambiguous?null:fields,unresolved_increment_fields:ambiguous?null:[...unresolved],
   current_account_state:null,economic_roi:null};
 });
 return {schema:'recorded-account-overwrite-timeline-v12',accounts,unknown,initial_state:seed?.status==='observed'?'prospective_local_snapshot':'not_established',seed_validation:seed,mutation_coverage:'not_established',limits:'Forward-only local snapshot and observed wallet/statistics/close/guard/cooldown/circuit/precision/capital-field/backfill/manual-local DB operations, conditional on supplied coverage. Snapshot-overlap writes stay ambiguous; omitted writers and economic costs prevent current-state or ROI inference.'};
}
