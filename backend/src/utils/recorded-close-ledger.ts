import { replayRecordedCloseRound } from './recorded-close-round';
import { replayRecordedCloseAccount } from './recorded-close-account';
import { replayRecordedWalletSync } from './recorded-wallet-sync';
interface CloseEvent {id:number|string;position_id?:string;timestamp:string;event_type:string;event_data:unknown}
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Conservative exact-one association; retries/duplicates cannot inflate independent closes. */
export function replayCloseLedgerJournal(events:readonly CloseEvent[],asOf:number){
 if(!Number.isFinite(asOf))throw Error('invalid_close_ledger_cutoff');
 const groups=new Map<string,{queries:CloseEvent[];writes:CloseEvent[];wallets:CloseEvent[]}>(),counts=new Map<string,number>();
 const unknown:{event_id:number|string;reason:string}[]=[];let excludedFuture=0;
 const eligible=events.filter(e=>{if(!['close_round_query_observed','close_account_update_applied','wallet_sync_observed'].includes(e.event_type))return false;
  const known=Date.parse(e.timestamp);if(Number.isFinite(known)&&known>asOf){excludedFuture++;return false;}return true;});
 for(const e of eligible)counts.set(String(e.id),(counts.get(String(e.id))??0)+1);
 for(const e of eligible){
  if(!Number.isFinite(Date.parse(e.timestamp))||e.id==null||e.id===''){unknown.push({event_id:e.id,reason:'missing_identity_or_knowledge_time'});continue;}
  if(typeof e.position_id!=='string'||!e.position_id){unknown.push({event_id:e.id,reason:'missing_position_association'});continue;}
  let group=groups.get(e.position_id);if(!group){group={queries:[],writes:[],wallets:[]};groups.set(e.position_id,group);}
  (e.event_type==='close_round_query_observed'?group.queries:e.event_type==='wallet_sync_observed'?group.wallets:group.writes).push(e);
 }
 const rows=[...groups].map(([position_id,group])=>{
  const query=group.queries[0],write=group.writes[0];
  const fail=(reason:string)=>({position_id,status:'unknown' as const,reason});
  if(group.queries.length!==1||group.writes.length!==1)return fail('missing_or_ambiguous_query_write');
  if(counts.get(String(query.id))!==1||counts.get(String(write.id))!==1)return fail('duplicate_event_identity');
  const round=replayRecordedCloseRound(query.event_data,Date.parse(query.timestamp),asOf),account=replayRecordedCloseAccount(write.event_data,Date.parse(write.timestamp),asOf);
  if(round.status!=='evaluated'||account.status!=='evaluated')return {...fail('unverified_component'),round,account};
  const data=object(write.event_data),input=object(data?.input),queryData=object(query.event_data),observations=object(queryData?.observations);
  if(input?.fill_verified!==true||input.binance_enabled!==true)return fail('missing_exchange_verified_close');
  const received=Date.parse(String(observations?.received_at??'')),last=Date.parse(String(input.last_trade_time??''));
  // Telemetry writes may persist out of order. Check the actual observed/application clocks instead.
  if(received>last)return fail('account_update_precedes_query_receipt');
  const walletAssociation=(()=>{
   const missing=(reason:string)=>({status:'unknown' as const,reason});
   if(group.wallets.length!==1)return missing('missing_or_ambiguous_wallet_write');
   const event=group.wallets[0];
   if(counts.get(String(event.id))!==1)return missing('duplicate_wallet_identity');
   const wallet=replayRecordedWalletSync(event.event_data,Date.parse(event.timestamp),asOf);
   if(wallet.status!=='evaluated')return {...missing('unverified_wallet_component'),wallet};
   if(wallet.account_id!==account.account_id)return missing('wallet_account_mismatch');
   if(account.application_ordering!=='db_return_observed')return missing('account_application_order_unknown');
   const walletData=object(event.event_data),requested=Date.parse(String(walletData?.requested_at??'')),applied=Date.parse(String(data?.applied_at??''));
   if(requested<applied)return missing('wallet_query_precedes_account_application');
   // An absolute exchange snapshot replaces local balance; it is never a second PnL delta.
   return {status:'associated' as const,event_id:event.id,wallet,matches_recorded:wallet.matches_recorded,
    balance_operation:'absolute_overwrite' as const,additional_realized_pnl:null};
  })();
  return {position_id,status:'associated' as const,query_event_id:query.id,account_event_id:write.id,round,account,
   wallet_association:walletAssociation,
   matches_recorded:account.matches_recorded&&input.realized_pnl===round.exchange_net_pnl,
   exchange_net_pnl:round.exchange_net_pnl,economic_total_pnl:null,ledger_completeness:'not_established' as const};
 });
 return {schema:'recorded-close-ledger-journal-v1',as_of:new Date(asOf).toISOString(),rows,unknown,excludedFuture,
  limits:'Exact-one position association and observed close/account/wallet consistency only; wallet evidence is an absolute overwrite, not additional PnL. No complete overwrite coverage, initial account state, provider-cost allocation, independent waves or full ROI inference.'};
}
