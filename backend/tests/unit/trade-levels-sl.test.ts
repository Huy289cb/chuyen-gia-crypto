import { describe, expect, it } from 'vitest';
import {
  checkMinSlDistance,
  computePolicyCompliantStopAndTarget,
} from '../../src/utils/trade-levels';

/** Production 9 Jul: LLM levels at exactly 0.80% blocked by raw float compare. */
describe('checkMinSlDistance', () => {
  it('accepts 0.80% long SL at IEEE float boundary', () => {
    const entry = 62320;
    const sl = 61821.44;
    const minPct = 0.008;
    const check = checkMinSlDistance(entry, sl, minPct);
    expect(check.ok).toBe(true);
    expect(check.distancePct).toBeLessThan(minPct);
    expect((check.distancePct * 100).toFixed(2)).toBe('0.80');
  });

  it('accepts 0.80% short SL at IEEE float boundary', () => {
    const entry = 61950;
    const sl = 62445.6;
    const minPct = 0.008;
    const check = checkMinSlDistance(entry, sl, minPct);
    expect(check.ok).toBe(true);
    expect((check.distancePct * 100).toFixed(2)).toBe('0.80');
  });

  it('rejects clearly tight SL', () => {
    expect(checkMinSlDistance(61950, 62200, 0.008).ok).toBe(false);
  });
});

describe('computePolicyCompliantStopAndTarget', () => {
  it('policy SL meets min after cent rounding', () => {
    const minPct = 0.008;
    const long = computePolicyCompliantStopAndTarget({
      action: 'buy',
      entry: 62320,
      minSlPct: minPct,
      minRr: 1,
    });
    expect(long).not.toBeNull();
    expect(checkMinSlDistance(62320, long!.stopLoss, minPct).ok).toBe(true);

    const short = computePolicyCompliantStopAndTarget({
      action: 'sell',
      entry: 61950,
      minSlPct: minPct,
      minRr: 1,
    });
    expect(short).not.toBeNull();
    expect(checkMinSlDistance(61950, short!.stopLoss, minPct).ok).toBe(true);
  });
});
