/** Provider evidence only: never accept arbitrary request/response payloads. */
const fields = ['provider_purpose','caller_context_status','candle_cutoff','request_id','trace_id','provider','model','status','ok','latency_ms','cost_usd','cost_status','input_tokens','output_tokens','code_hash','policy_hash','lane','decision_id','evaluated_at'] as const;
export type ProviderJournalEventType = 'llm_provider_request'|'llm_provider_result';
export function buildProviderJournalRecord(eventType: string, data: Record<string,unknown>) {
  if (eventType !== 'llm_provider_request' && eventType !== 'llm_provider_result') throw new Error('invalid_provider_event_type');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_provider_metadata');
  const metadata: Record<string,unknown> = {};
  for (const key of fields) if (Object.hasOwn(data,key)) {
    const value=data[key];
    if (value!==null && !['string','number','boolean'].includes(typeof value)) throw new Error('invalid_provider_field');
    if (typeof value==='number' && !Number.isFinite(value)) throw new Error('invalid_provider_field');
    metadata[key]=value;
  }
  for (const key of ['request_id','provider','model']) {
    if (typeof metadata[key]!=='string' || !(metadata[key] as string).trim() || (metadata[key] as string).length>512) throw new Error('invalid_provider_identity');
  }
  for (const key of ['cost_usd','latency_ms','input_tokens','output_tokens']) {
    if (metadata[key]!==undefined && metadata[key]!==null && (typeof metadata[key]!=='number' || (metadata[key] as number)<0)) throw new Error('invalid_provider_quantity');
  }
  if (metadata.cost_status==='reported' && typeof metadata.cost_usd!=='number') throw new Error('missing_reported_cost');
  return {request_id:metadata.request_id as string,event_type:eventType as ProviderJournalEventType,metadata};
}
