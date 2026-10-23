import type { ProviderPurpose } from './provider-purpose-context';
const purposes = new Set<ProviderPurpose>(['dispatch','pending_review','opposite_flip','shadow','levels_repair','tp_repair','opportunity_review','post_exit','telegram']);

/** Economic cost attribution from recorded metadata; usage tokens do not imply a price. */
export function buildProviderCostJournal(events: readonly {
  event_type:string; event_data:Record<string,unknown>;
}[]) {
  const requests=new Map<string,{trace_id:string|null;results:Record<string,unknown>[];starts:Record<string,unknown>[]}>();
  let unlinked=0;
  for(const event of events){
    if(!['llm_provider_request','llm_provider_result'].includes(event.event_type))continue;
    const data=event.event_data;
    if(typeof data.request_id!=='string'||!data.request_id){unlinked++;continue;}
    let request=requests.get(data.request_id);
    if(!request){request={trace_id:typeof data.trace_id==='string'?data.trace_id:null,results:[],starts:[]};requests.set(data.request_id,request);}
    if(event.event_type==='llm_provider_result')request.results.push(data);else request.starts.push(data);
  }
  let knownSubtotalUsd=0,unknownRequests=0,incompletePairs=0;
  const rows=[...requests].map(([request_id,request])=>{
    const result=request.results[0],start=request.starts[0];
    const paired=request.starts.length===1&&request.results.length===1&&
      ['provider','model','provider_purpose'].every(k=>typeof start?.[k]==='string'&&Boolean(start[k])&&start[k]===result?.[k]) && purposes.has(start.provider_purpose as ProviderPurpose) &&
      ((typeof start.trace_id==='string' && Boolean(start.trace_id) && start.trace_id===result.trace_id) || (start.trace_id===null && result.trace_id===null));
    if(!paired)incompletePairs++;
    const pair_reason=paired?null:request.starts.length===0?'missing_request':request.starts.length>1?'duplicate_requests':request.results.length!==1?'missing_or_duplicate_result':'metadata_or_trace_mismatch';
    const known=request.results.length===1&&result?.cost_status==='reported'&&
      typeof result.cost_usd==='number'&&Number.isFinite(result.cost_usd)&&result.cost_usd>=0;
    const cost_usd=known?result.cost_usd as number:null;
    if(cost_usd===null)unknownRequests++;else knownSubtotalUsd+=cost_usd;
    return {request_id,trace_id:request.trace_id,provider_purpose:paired?start.provider_purpose:null,trade_attribution:paired&&typeof start.trace_id==='string'?'linked':'not_established',cost_usd,pair_status:paired?'matched':'unknown',pair_reason,
      cost_status:known?'reported':'unknown',
      reason:known?null:request.results.length>1?'duplicate_results':!result?'missing_result':'missing_reported_cost'};
  });
  return {schema:'provider-cost-journal-v5',requests:rows,unknownRequests,unlinked,incompletePairs,
    knownSubtotalUsd:Number.isFinite(knownSubtotalUsd)?knownSubtotalUsd:null,recordedSubtotalUsd:unknownRequests||unlinked||incompletePairs||!rows.length||!Number.isFinite(knownSubtotalUsd)?null:knownSubtotalUsd,
    totalCostUsd:null,request_coverage:'not_established' as const,
    limits:'Only supplied provider requests. Exchange fees/funding, incremental infrastructure and provider events outside coverage remain separate. Missing costs are never zero.'};
}
