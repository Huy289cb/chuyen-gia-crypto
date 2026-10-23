import { replayRecordedProtectiveAction } from './recorded-protective-action';

interface ProtectionEvent {
  id: number | string;
  timestamp: string;
  position_id?: string;
  event_type: string;
  event_data: unknown;
}

/** DB persistence time is the knowledge boundary; later rows never repair an earlier replay. */
export function replayProtectionJournal(events: readonly ProtectionEvent[], asOf: number) {
  if (!Number.isFinite(asOf)) throw Error('invalid_protection_journal_cutoff');
  let excludedFuture = 0;
  const eligible = events.filter(event => {
    if (event.event_type !== 'protective_action_evaluated') return false;
    const knownAt = Date.parse(event.timestamp);
    if (Number.isFinite(knownAt) && knownAt > asOf) { excludedFuture++; return false; }
    return true;
  });
  const counts = new Map<string, number>();
  for (const event of eligible) counts.set(String(event.id), (counts.get(String(event.id)) ?? 0) + 1);
  const rows = eligible.map(event => {
    const knownAt = Date.parse(event.timestamp);
    const data = event.event_data;
    let result: ReturnType<typeof replayRecordedProtectiveAction>;
    if (event.id === '' || (typeof event.id !== 'string' && (!Number.isFinite(event.id) || !Number.isSafeInteger(event.id))))
      result = { status: 'unknown', reason: 'invalid_event_id' };
    else if (counts.get(String(event.id)) !== 1) result = { status: 'unknown', reason: 'duplicate_event_id' };
    else if (!Number.isFinite(knownAt)) result = { status: 'unknown', reason: 'missing_event_time' };
    else if (!data || typeof data !== 'object') result = { status: 'unknown', reason: 'missing_record' };
    else {
      const observedAt = Date.parse(String((data as Record<string, unknown>).observed_at ?? ''));
      if (!Number.isFinite(observedAt)) result = { status: 'unknown', reason: 'missing_observation_time' };
      else if (observedAt > knownAt) result = { status: 'unknown', reason: 'observation_after_persistence' };
      else result = replayRecordedProtectiveAction(data);
    }
    return { event_id: event.id, position_id: typeof event.position_id === 'string' && event.position_id ? event.position_id : null, known_at: Number.isFinite(knownAt) ? new Date(knownAt).toISOString() : null, result };
  });
  const evaluated = rows.filter(row => row.result.status === 'evaluated');
  return {
    schema: 'recorded-protection-journal-v1', as_of: new Date(asOf).toISOString(), rows, excludedFuture,
    evaluated: evaluated.length, unknown: rows.length - evaluated.length,
    mismatches: evaluated.filter(row => row.result.status === 'evaluated' && !row.result.matches_recorded).length,
    limits: 'Recorded protective action only. Placement decisions do not establish exchange acknowledgement, protection coverage or portfolio state.',
  };
}
