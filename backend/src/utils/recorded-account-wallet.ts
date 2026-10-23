import { replayRecordedWalletSync } from './recorded-wallet-sync';
interface WalletEvent {id:number|string;event_type:string;timestamp:string;event_data:unknown}
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Account-level observations only. Position copies cannot become additional writes. */
export function replayAccountWalletJournal(events:readonly WalletEvent[],asOf:number){
 if(!Number.isFinite(asOf))throw Error('invalid_wallet_cutoff');
 let excludedFuture=0,ignoredPositionCopies=0;
 const eligible=events.filter(e=>{
  if(e.event_type==='wallet_sync_observed'){ignoredPositionCopies++;return false;}
  if(e.event_type!=='account_wallet_sync_observed')return false;
  if(Date.parse(e.timestamp)>asOf){excludedFuture++;return false;}return true;
 });
 const ids=new Map<string,number>(),attempts=new Map<string,number>();
 for(const e of eligible){ids.set(String(e.id),(ids.get(String(e.id))??0)+1);const d=object(e.event_data);if(typeof d?.sync_attempt_id==='string')attempts.set(d.sync_attempt_id,(attempts.get(d.sync_attempt_id)??0)+1);}
 const rows=eligible.map(e=>{
  const fail=(reason:string)=>({event_id:e.id,status:'unknown' as const,reason});
  if(e.id==null||e.id===''||!Number.isFinite(Date.parse(e.timestamp)))return fail('missing_identity_or_knowledge_time');
  const d=object(e.event_data),attempt=d?.sync_attempt_id;
  if(typeof attempt!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt))return fail('missing_sync_attempt_identity');
  if(ids.get(String(e.id))!==1||attempts.get(attempt)!==1)return fail('ambiguous_sync_observation');
  const wallet=replayRecordedWalletSync(d,Date.parse(e.timestamp),asOf);
  if(wallet.status!=='evaluated')return {...fail('unverified_wallet_component'),wallet};
  return {event_id:e.id,status:'evaluated' as const,sync_attempt_id:attempt,account_id:wallet.account_id,
   requested_at:d!.requested_at,applied_at:d!.applied_at,known_at:e.timestamp,matches_recorded:wallet.matches_recorded,
   balance_operation:'absolute_overwrite' as const,expected_update:wallet.expected_update,economic_total_pnl:null};
 });
 return {schema:'recorded-account-wallet-journal-v1',as_of:new Date(asOf).toISOString(),rows,excludedFuture,ignoredPositionCopies,
  ledger_completeness:'not_established' as const,limits:'Unique observed wallet overwrites only. No inferred ordering of concurrent writes, complete mutation coverage, initial state, transfers, provider costs or ROI.'};
}
