import { describe, it, expect } from 'vitest';
import { replayRecordedProtectiveAction } from '../../src/utils/recorded-protective-action';

const record = { schema: 'protective-action-v1', stage: 'planned', mark_status: 'observed',
  input: { side: 'long', stop_loss: 90, take_profit: 110, mark: 100 }, decision: 'place_sl_tp' };
describe('recorded protective action', () => {
  it('replays a JSON input and detects a divergent recorded decision', () => {
    expect(replayRecordedProtectiveAction(JSON.parse(JSON.stringify(record)))).toEqual({ status: 'evaluated', decision: 'place_sl_tp', matches_recorded: true });
    expect(replayRecordedProtectiveAction({ ...record, decision: 'close_at_market_loss' })).toEqual({ status: 'evaluated', decision: 'place_sl_tp', matches_recorded: false });
  });
  it('does not turn fallback mark or malformed input into evidence', () => {
    for (const mark_status of ['missing', 'failed']) expect(replayRecordedProtectiveAction({ ...record, mark_status }).status).toBe('unknown');
    for (const mark of [0, null, NaN]) expect(replayRecordedProtectiveAction({ ...record, input: { ...record.input, mark } }).status).toBe('unknown');
    expect(replayRecordedProtectiveAction({ ...record, input: { ...record.input, stop_loss: null } }).status).toBe('unknown');
  });
  it('requires measured recomputed levels and uses them for the breach', () => {
    expect(replayRecordedProtectiveAction({ ...record, stage: 'recomputed' }).status).toBe('unknown');
    expect(replayRecordedProtectiveAction({ ...record, stage: 'recomputed', input: { ...record.input, levels: { stop_loss: 101, take_profit: 110 } }, decision: 'close_at_market_loss' }))
      .toEqual({ status: 'evaluated', decision: 'close_at_market_loss', matches_recorded: true });
  });
});
