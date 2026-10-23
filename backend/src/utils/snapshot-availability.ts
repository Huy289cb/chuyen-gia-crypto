/** Record timestamps do not prove transaction commit/publication visibility. */
export function describeSnapshotAvailability(snapshot:Record<string,any>,replayCutoff:number){
 const observation=snapshot.snapshot_observed_at===undefined?NaN:Date.parse(snapshot.snapshot_observed_at),through=Date.parse(snapshot.through);
 return {status:'not_established_at_original_decisions' as const,observation_known_at:Number.isFinite(observation)?new Date(observation).toISOString():null,
 observation_clock_valid:Number.isFinite(observation)&&Number.isFinite(through)&&observation>=through,
 snapshot_observed_by_replay_cutoff:Number.isFinite(observation)&&Number.isFinite(replayCutoff)?observation<=replayCutoff:null,
 commit_visibility_at_recorded_event_time:'not_established' as const,causal_inputs_at_each_decision:null,
 component_results_scope:'retrospective_supplied_observations_only' as const};
}
