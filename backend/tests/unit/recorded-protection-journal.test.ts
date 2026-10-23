import { describe, it, expect } from 'vitest';
import { replayProtectionJournal } from '../../src/utils/recorded-protection-journal';
const at = Date.parse('2026-10-02T10:30:00Z');
const event = { id: 1, position_id: 'position1', timestamp: new Date(at).toISOString(), event_type: 'protective_action_evaluated',
  event_data: { schema: 'protective-action-v1', stage: 'planned', observed_at: new Date(at - 1000).toISOString(), mark_status: 'observed',
    input: { side: 'long', stop_loss: 90, take_profit: 110, mark: 100 }, decision: 'place_sl_tp' } };
describe('protection journal knowledge cutoff', () => {
  it('excludes future persistence even when its observation predates cutoff', () => {
    const early = replayProtectionJournal([event], at - 1);
    expect(early.rows).toEqual([]); expect(early.excludedFuture).toBe(1);
    const visible = replayProtectionJournal([event], at);
    expect(visible.evaluated).toBe(1); expect(visible.rows[0].position_id).toBe('position1');
    expect(replayProtectionJournal([{ ...event, position_id: undefined }], at).rows[0].position_id).toBeNull();
  });
  it('rejects missing and reversed clocks', () => {
    for (const observed_at of [undefined, new Date(at + 1).toISOString()]) {
      expect(replayProtectionJournal([{ ...event, event_data: { ...event.event_data, observed_at } }], at).unknown).toBe(1);
    }
    expect(replayProtectionJournal([{ ...event, timestamp: 'invalid' }], at).unknown).toBe(1);
    expect(() => replayProtectionJournal([], NaN)).toThrow();
  });
  it('rejects all duplicate evidence and ignores unrelated journal types', () => {
    const result = replayProtectionJournal([event, { ...event, event_data: { ...event.event_data, decision: 'close_at_market_loss' } }, { ...event, event_type: 'entry_trace' }], at);
    expect(result.evaluated).toBe(0); expect(result.unknown).toBe(2);
    expect(result.rows.every(row => row.result.status === 'unknown' && row.result.reason === 'duplicate_event_id')).toBe(true);
  });
  it('reports actual mismatches separately from missing mark evidence', () => {
    const result = replayProtectionJournal([event,
      { ...event, id: 2, event_data: { ...event.event_data, decision: 'close_at_market_loss' } },
      { ...event, id: 3, event_data: { ...event.event_data, mark_status: 'missing' } }], at);
    expect(result.evaluated).toBe(2); expect(result.mismatches).toBe(1); expect(result.unknown).toBe(1);
  });
});
