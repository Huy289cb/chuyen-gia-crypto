import {currentProviderPurpose} from './provider-purpose-context';
import {currentEntryTrace} from './entry-trace';
/** Snapshot once at request start; absent caller context is never fabricated. */
export function captureProviderRequestContext(){
 const trace=currentEntryTrace();
 return {provider_purpose:currentProviderPurpose(),caller_context_status:trace?'entry_trace_snapshot':'not_supplied',
  trace_id:trace?.trace_id??null,lane:trace?.lane??null,decision_id:trace?.decision_id??null,
  code_hash:trace?.code_hash??null,policy_hash:trace?.policy_hash??null,
  evaluated_at:trace?.evaluated_at??null,candle_cutoff:trace?.candle_cutoff??null};
}
