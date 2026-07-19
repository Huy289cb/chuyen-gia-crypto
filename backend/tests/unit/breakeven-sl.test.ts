import { describe, expect, it } from 'vitest';
import { feeAwareBreakevenSl } from '../../src/utils/breakeven-sl';

describe('feeAwareBreakevenSl', () => {
  it('long: entry * (1 + buffer)', () => {
    expect(feeAwareBreakevenSl('long', 64415.6, 0.08)).toBe(
      Math.round(64415.6 * 1.0008 * 100) / 100
    );
  });

  it('short: entry * (1 - buffer)', () => {
    expect(feeAwareBreakevenSl('short', 64415.6, 0.08)).toBe(
      Math.round(64415.6 * 0.9992 * 100) / 100
    );
  });

  it('zero buffer = entry', () => {
    expect(feeAwareBreakevenSl('long', 64415.6, 0)).toBe(64415.6);
  });
});
