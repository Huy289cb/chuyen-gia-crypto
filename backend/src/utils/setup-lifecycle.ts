/** Event-sourced lifecycle reducer shared by prospective journal and replay. */
export type SetupLifecycleKind = 'observed' | 'confirmed' | 'invalidated' | 'expired';
export interface SetupLifecycleEvent {
  event_id: string;
  setup_id: string;
  kind: SetupLifecycleKind;
  occurred_at: number;
  known_at: number;
  detector_version: string;
}
export interface SetupLifecycleState {
  setup_id: string;
  detector_version: string;
  first_seen_at: number;
  confirmed_at: number | null;
  invalidated_at: number | null;
  expired_at: number | null;
  status: SetupLifecycleKind;
  last_known_at: number;
  event_ids: string[];
}
export function reduceSetupLifecycle(
  state: SetupLifecycleState | null, event: SetupLifecycleEvent, asOf: number
): SetupLifecycleState {
  if (!event.setup_id || !event.event_id || !event.detector_version ||
    !['observed','confirmed','invalidated','expired'].includes(event.kind) ||
    !Number.isFinite(asOf) || !Number.isFinite(event.occurred_at) || !Number.isFinite(event.known_at) ||
    event.occurred_at < 0 || event.known_at < event.occurred_at || event.known_at > asOf) {
    throw Error('invalid_or_future_setup_event');
  }
  if (!state) {
    if (event.kind !== 'observed') throw Error('setup_first_event_must_be_observed');
    return {setup_id:event.setup_id,detector_version:event.detector_version,
      first_seen_at:event.known_at,confirmed_at:null,invalidated_at:null,expired_at:null,
      status:'observed',last_known_at:event.known_at,event_ids:[event.event_id]};
  }
  if (state.setup_id !== event.setup_id || state.detector_version !== event.detector_version) throw Error('setup_identity_mismatch');
  if (state.event_ids.includes(event.event_id)) throw Error('duplicate_setup_event');
  if (event.known_at < state.last_known_at) throw Error('setup_event_order');
  if (state.status === 'invalidated' || state.status === 'expired') throw Error('setup_already_terminal');
  if (event.kind === 'confirmed' && state.confirmed_at !== null) throw Error('setup_already_confirmed');
  return {...state,
    status:event.kind === 'observed' ? state.status : event.kind,
    confirmed_at:event.kind === 'confirmed' ? event.known_at : state.confirmed_at,
    invalidated_at:event.kind === 'invalidated' ? event.known_at : state.invalidated_at,
    expired_at:event.kind === 'expired' ? event.known_at : state.expired_at,
    last_known_at:event.known_at,event_ids:[...state.event_ids,event.event_id]};
}
