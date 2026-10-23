import { associateSetupWave, type WaveAnchorEvidence } from './setup-wave';
import { reduceSetupLifecycle, type SetupLifecycleState } from './setup-lifecycle';

export interface RecordedSetupEvent {
  id: number | string;
  timestamp: string;
  event_type: string;
  event_data: Record<string, unknown>;
}
/** Materialize persisted measurement events. Missing old anchors are not reconstructed. */
export function buildSetupRegistry(events: readonly RecordedSetupEvent[], asOf: number) {
  if (!Number.isFinite(asOf)) throw Error('invalid_registry_cutoff');
  const states = new Map<string, SetupLifecycleState>();
  const anchors = new Map<string, WaveAnchorEvidence>();
  const waveAssociations: {event_id:string; known_at:number; status:string; reason:string|null;
    wave_id:string|null; parent_setup_id:string|null; child_setup_id:string}[] = [];
  const seen = new Set<string>();
  const coverage = { input_events:events.length, considered:0, known:0, unknown:0, future:0, duplicate:0, rejected:0 };
  const rejected: {event_id:string; reason:string}[] = [];
  const rows = events.filter(e => e.event_type === 'gate_funnel_shadow' ||
    (e.event_type === 'entry_trace' && e.event_data.stage === 'setup_identified'))
    .slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||String(a.id).localeCompare(String(b.id)));
  for (const row of rows) {
    coverage.considered++;
    const eventId=String(row.id);
    if (seen.has(eventId)) {coverage.duplicate++;continue;}
    seen.add(eventId);
    const knownAt=Date.parse(row.timestamp);
    if (!Number.isFinite(knownAt)) {coverage.rejected++;rejected.push({event_id:eventId,reason:'invalid_timestamp'});continue;}
    if (knownAt>asOf) {coverage.future++;continue;}
    const identity=row.event_data.setup_identity as Record<string,unknown> | undefined;
    if (!identity || identity.status !== 'known') {coverage.unknown++;continue;}
    const occurredAt=identity.detection_known_at;
    if (identity.schema !== 'setup-anchor-identity-v1' || typeof identity.setup_id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(identity.setup_id) || typeof occurredAt !== 'number' ||
      !Number.isFinite(occurredAt) || occurredAt>knownAt) {
      coverage.rejected++;rejected.push({event_id:eventId,reason:'invalid_identity_or_future_detection'});continue;
    }
    try {
      const state=reduceSetupLifecycle(states.get(identity.setup_id)??null,{
        event_id:eventId,setup_id:identity.setup_id,detector_version:'setup-anchor-identity-v1',
        kind:'observed',occurred_at:occurredAt,known_at:knownAt,
      },asOf);
      states.set(identity.setup_id,state);coverage.known++;
      const evidence = identity.anchor_evidence as Record<string, unknown> | undefined;
      if (evidence && typeof evidence.symbol === 'string' && typeof evidence.timeframe === 'string' &&
        ['long','short'].includes(String(evidence.side)) &&
        ['high','low','high_open','low_open'].every(key=>typeof evidence[key]==='number' && Number.isFinite(evidence[key]))) {
        const child: WaveAnchorEvidence = {
          setup_id:identity.setup_id,symbol:evidence.symbol,side:evidence.side as 'long'|'short',timeframe:evidence.timeframe,
          high:evidence.high as number,low:evidence.low as number,
          high_open:evidence.high_open as number,low_open:evidence.low_open as number,known_at:knownAt,
        };
        const links=[...anchors.values()].filter(a=>a.setup_id!==child.setup_id)
          .map(parent=>associateSetupWave(parent,child,knownAt)).filter(link=>link.status==='linked');
        if (links.length===1) waveAssociations.push({event_id:eventId,...links[0],known_at:knownAt});
        else waveAssociations.push({event_id:eventId,known_at:knownAt,status:'unknown',
          reason:links.length?'ambiguous_parents':'no_known_matching_parent',wave_id:null,
          parent_setup_id:null,child_setup_id:child.setup_id});
        // Retain first knowledge, not the most recent observation timestamp.
        if(!anchors.has(child.setup_id)) anchors.set(child.setup_id,child);
      } else waveAssociations.push({event_id:eventId,known_at:knownAt,status:'unknown',
        reason:'missing_anchor_evidence',wave_id:null,parent_setup_id:null,child_setup_id:identity.setup_id});
    } catch(error) {coverage.rejected++;rejected.push({event_id:eventId,reason:error instanceof Error?error.message:'unknown_error'});}
  }
  return {schema:'recorded-setup-registry-v1',as_of:new Date(asOf).toISOString(),coverage,
    setups:[...states.values()],rejected,wave_associations:waveAssociations,
    independent_wave_count:null,
    limits:'Observed same-frame anchors only. first_seen_at is first persisted observation in supplied coverage, not setup birth. Confirmation/expiration/invalidation/wave links require explicit causal evidence; no fills or ROI inference.'};
}
