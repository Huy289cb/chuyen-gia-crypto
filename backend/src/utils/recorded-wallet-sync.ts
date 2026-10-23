import { buildWalletSyncUpdate } from './wallet-sync-update';
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const time=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
export function replayRecordedWalletSync(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!Number.isFinite(knownAt)||!Number.isFinite(asOf))return unknown('missing_knowledge_time');
 if(knownAt>asOf)return unknown('not_known_at_cutoff');
 const data=object(record),snapshot=object(data?.snapshot),update=object(data?.update);
 if(data?.schema!=='wallet-sync-v1'||!Number.isSafeInteger(data.account_id)||Number(data.account_id)<=0)return unknown('missing_sync_identity');
 if(data.status!=='applied')return unknown(data.status==='metadata_unavailable'?'metadata_unavailable':'no_applied_wallet_write');
 if(data.source!=='normalized_account_api'||!snapshot||!update||![snapshot.walletBalance,snapshot.equity,snapshot.unrealizedPnl].every(Number.isFinite))return unknown('missing_wallet_snapshot');
 const requested=time(data.requested_at),received=time(data.received_at),applied=time(data.applied_at),updated=time(update.updated_at);
 if(![requested,received,updated,applied].every(Number.isFinite)||requested>received||received>updated||updated>applied||applied>knownAt)return unknown('invalid_sync_clocks');
 const expected=buildWalletSyncUpdate({walletBalance:snapshot.walletBalance as number,equity:snapshot.equity as number,unrealizedPnl:snapshot.unrealizedPnl as number},new Date(updated));
 const serialized={...expected,updated_at:expected.updated_at.toISOString()};
 return {status:'evaluated' as const,account_id:data.account_id as number,expected_update:serialized,
  matches_recorded:Object.keys(update).length===Object.keys(serialized).length&&Object.entries(serialized).every(([key,value])=>update[key]===value),
  economic_wallet_verification:'not_established' as const,limits:'Normalized account snapshot and local overwrite only. Raw asset selection, external transfers, initial ledger and provider costs are separate evidence.'};
}
