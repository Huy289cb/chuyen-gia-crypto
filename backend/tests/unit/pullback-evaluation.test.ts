import { describe, it, expect } from 'vitest';
import { evaluateRecordedPullback } from '../../src/utils/pullback-evaluation';
import { evaluateTrendPullbackEntry } from '../../src/config/v3-entry-policy';

describe('recorded production pullback', () => {
  it('replays long/short pass and veto exactly from recorded inputs', () => {
    for (const side of ['long','short'] as const) for (const entry of [98,100,102]) {
      const input = { side, entry, closes: [500, ...Array(20).fill(100)], smaPeriod: 20,
        maxAbovePct: .25, maxBelowPct: 1, enabled: true, tfLabel: 'SMA20@15m' };
      const recorded = evaluateRecordedPullback(input);
      expect(recorded.result).toEqual(evaluateTrendPullbackEntry(input));
      expect(evaluateRecordedPullback(JSON.parse(JSON.stringify(recorded.input)))).toEqual(recorded);
      expect(recorded.input.closes).toHaveLength(20);
    }
  });
  it('labels insufficient data unavailable even when legacy guard skips', () => {
    const recorded = evaluateRecordedPullback({ side:'long',entry:100,closes:[100],smaPeriod:20,
      maxAbovePct:.25,maxBelowPct:1,enabled:true,tfLabel:'SMA20@15m' });
    expect(recorded.result.pass).toBe(true);
    expect(recorded.dataStatus).toBe('unavailable');
  });
});
