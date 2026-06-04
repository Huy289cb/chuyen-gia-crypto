import { describe, it, expect } from 'vitest';
import {
  recomputeSlTpFromFill,
  isOrderWouldTriggerImmediatelyError,
} from '../../src/services/protective-order.service';
import { parseV3ClientOrderId } from '../../src/services/binance-order-fill.service';

describe('recomputeSlTpFromFill', () => {
  it('widens short SL when fill slips above planned entry (Jun 4 incident)', () => {
    const { stop_loss, take_profit } = recomputeSlTpFromFill({
      side: 'short',
      fillPrice: 63192.9,
      plannedEntry: 62350,
      plannedSl: 62650,
      plannedTp: 61750,
      markPrice: 63192.9,
      minSlDistancePercent: 0.004,
    });
    expect(stop_loss).toBeGreaterThan(63192.9);
    expect(take_profit).toBeLessThan(63192.9);
    expect(stop_loss - 63192.9).toBeCloseTo(62650 - 62350, 0);
  });

  it('buffers short SL above mark when planned SL is behind market', () => {
    const { stop_loss } = recomputeSlTpFromFill({
      side: 'short',
      fillPrice: 63935,
      plannedEntry: 62350,
      plannedSl: 62650,
      plannedTp: 61750,
      markPrice: 63935,
      minSlDistancePercent: 0.004,
    });
    expect(stop_loss).toBeGreaterThan(63935);
  });

  it('widens long SL below fill when fill slips down', () => {
    const { stop_loss } = recomputeSlTpFromFill({
      side: 'long',
      fillPrice: 61000,
      plannedEntry: 62000,
      plannedSl: 61700,
      plannedTp: 62600,
      markPrice: 61000,
      minSlDistancePercent: 0.004,
    });
    expect(stop_loss).toBeLessThan(61000);
  });
});

describe('isOrderWouldTriggerImmediatelyError', () => {
  it('detects Binance -2021', () => {
    expect(
      isOrderWouldTriggerImmediatelyError(new Error('Binance API Error -2021: Order would immediately trigger.'))
    ).toBe(true);
  });
});

describe('parseV3ClientOrderId', () => {
  it('parses x-v3 prefix', () => {
    expect(parseV3ClientOrderId('x-v3_1780570263159_qo50ft')).toBe('v3_1780570263159_qo50ft');
  });

  it('accepts v3_ without x prefix', () => {
    expect(parseV3ClientOrderId('v3_abc_def')).toBe('v3_abc_def');
  });
});
