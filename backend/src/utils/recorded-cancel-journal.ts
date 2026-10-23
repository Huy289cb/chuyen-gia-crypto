import { replayRecordedCancelAck, replayRecordedCancelClaim } from './pending-cancel-transition';
interface CancelEvent { id:number|string;timestamp:string;event_type:string;event_data:Record<string,unknown> }
export function replayCancelJournal(events:readonly CancelEvent[],asOf:number){
 if(!Number.isFinite(asOf))throw Error('invalid_cancel_journal_cutoff');
 const attempts=new Map<string,{acks:CancelEvent[];claims:CancelEvent[]}>();
 const unknown:{event_id:string;reason:string}[]=[];
 const seen=new Set<string>();let excludedFuture=0;
 for(const event of events){
  if(!['pending_cancel_ack','pending_cancel_db_claim','pending_order_cancelled'].includes(event.event_type))continue;
  const id=String(event.id),time=Date.parse(event.timestamp);
  if(!Number.isFinite(time)){unknown.push({event_id:id,reason:'missing_event_time'});continue;}
  if(time>asOf){excludedFuture++;continue;}
  if(seen.has(id)){unknown.push({event_id:id,reason:'duplicate_event_id'});continue;}seen.add(id);
  const key=event.event_data.cancel_attempt_id;
  if(typeof key!=='string'||!key){unknown.push({event_id:id,reason:'missing_cancel_attempt_id'});continue;}
  let attempt=attempts.get(key);if(!attempt){attempt={acks:[],claims:[]};attempts.set(key,attempt);}
  if(event.event_type==='pending_cancel_ack')attempt.acks.push(event);
  else if(event.event_type==='pending_cancel_db_claim')attempt.claims.push(event);
 }
 const rows=[...attempts].map(([cancel_attempt_id,attempt])=>{
  const ack=attempt.acks[0],claim=attempt.claims[0];
  let transition:ReturnType<typeof replayRecordedCancelClaim>;
  if(attempt.acks.length!==1||attempt.claims.length!==1)transition={status:'unknown',reason:'missing_or_ambiguous_ack_claim'};
  else if(Date.parse(claim.timestamp)<Date.parse(ack.timestamp))transition={status:'unknown',reason:'claim_precedes_ack'};
  else transition=replayRecordedCancelClaim(ack.event_data,claim.event_data);
  return {cancel_attempt_id,ack_event_ids:attempt.acks.map(e=>e.id),claim_event_ids:attempt.claims.map(e=>e.id),
   ack:attempt.acks.length===1?replayRecordedCancelAck(ack.event_data):{status:'unknown',reason:'missing_or_ambiguous_ack'},transition};
 });
 return {schema:'recorded-cancel-journal-v1',as_of:new Date(asOf).toISOString(),rows,unknown,excludedFuture,
  limits:'Captured exchange ACK and DB claim only. Missing/legacy events unknown; no inference of fills, closed positions or full portfolio state.'};
}
