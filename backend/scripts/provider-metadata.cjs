// Deliberately whitelist primitive billing/linkage metadata. No nested provider payloads.
const fields=['provider_purpose','caller_context_status','candle_cutoff','request_id','trace_id','provider','model','status','ok','latency_ms','cost_usd',
 'cost_status','input_tokens','output_tokens','code_hash','policy_hash','lane','decision_id','evaluated_at'];
function pickProviderMetadata(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_provider_metadata');
 return Object.fromEntries(fields.filter(key=>Object.hasOwn(data,key)).map(key=>{
  const value=data[key];
  if(value!==null&&!['string','number','boolean'].includes(typeof value))throw Error('invalid_provider_field:'+key);
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('invalid_provider_field:'+key);
  return [key,value];
 }));
}
module.exports={pickProviderMetadata};
