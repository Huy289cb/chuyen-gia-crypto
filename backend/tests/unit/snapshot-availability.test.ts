import {it,expect} from 'vitest';import {describeSnapshotAvailability as describe} from '../../src/utils/snapshot-availability';
const t=Date.parse('2026-10-04T06:12:20.859Z'),iso=(n:number)=>new Date(t+n).toISOString();
it('does not backdate post-cutoff observations to event timestamps',()=>{expect(describe({through:iso(0),snapshot_observed_at:iso(1000)},t)).toMatchObject({snapshot_observed_by_replay_cutoff:false,causal_inputs_at_each_decision:null});});
it('keeps missing legacy observation clock unknown',()=>{expect(describe({through:iso(0)},t)).toMatchObject({observation_known_at:null,snapshot_observed_by_replay_cutoff:null});});
it('observation before cutoff still does not prove earlier decision availability',()=>{expect(describe({through:iso(-1000),snapshot_observed_at:iso(-1)},t)).toMatchObject({snapshot_observed_by_replay_cutoff:true,causal_inputs_at_each_decision:null,commit_visibility_at_recorded_event_time:'not_established'});});
