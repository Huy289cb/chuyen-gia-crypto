import { describe, expect, it, afterEach } from 'vitest';
import {
  isRangeEntryBlocked,
  resolveGateRegimeFromSignal,
} from '../../src/config/v3-entry-policy';

describe('v3-entry-policy gate regime', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('resolveGateRegimeFromSignal prefers gateRegime over LTF regime', () => {
    expect(
      resolveGateRegimeFromSignal({
        gateRegime: 'trend',
        setupResult: { regime: 'range' },
      })
    ).toBe('trend');
  });

  it('isRangeEntryBlocked uses effective gate regime (breakout bypass path)', () => {
    process.env.V3_BLOCK_RANGE_ENTRIES = 'true';
    const effective = resolveGateRegimeFromSignal({
      gateRegime: 'trend',
      setupResult: { regime: 'range' },
    });
    expect(isRangeEntryBlocked(effective)).toBe(false);
    expect(isRangeEntryBlocked('range')).toBe(true);
  });

  it('isRangeEntryBlocked off when V3_BLOCK_RANGE_ENTRIES=false', () => {
    process.env.V3_BLOCK_RANGE_ENTRIES = 'false';
    expect(isRangeEntryBlocked('range')).toBe(false);
  });
});
