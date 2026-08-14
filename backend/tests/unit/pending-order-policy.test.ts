import { describe, it, expect, afterEach } from 'vitest';
import {
  getPendingOrderTtlHours,
  getPendingOrderMaxDriftPct,
} from '../../src/config/pending-order-policy';

describe('pending-order-policy', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('returns short default TTL by timeframe (45m on 5m/15m)', () => {
    delete process.env.PENDING_ORDER_TTL_HOURS_5M;
    delete process.env.PENDING_ORDER_TTL_HOURS_15M;
    delete process.env.PENDING_ORDER_TTL_HOURS_1H;
    delete process.env.PENDING_ORDER_TTL_HOURS_4H;
    delete process.env.PENDING_ORDER_TTL_MAX_HOURS;
    expect(getPendingOrderTtlHours('5m')).toBe(0.75);
    expect(getPendingOrderTtlHours('15m')).toBe(0.75);
    expect(getPendingOrderTtlHours('1h')).toBe(2);
    expect(getPendingOrderTtlHours(null)).toBe(8);
  });

  it('respects env overrides capped by max', () => {
    process.env.PENDING_ORDER_TTL_HOURS_15M = '8';
    process.env.PENDING_ORDER_TTL_MAX_HOURS = '12';
    expect(getPendingOrderTtlHours('15m')).toBe(8);
    expect(getPendingOrderTtlHours('1h')).toBe(2); // default 2 < max 12
    process.env.PENDING_ORDER_TTL_HOURS_1H = '24';
    expect(getPendingOrderTtlHours('1h')).toBe(12); // capped
  });

  it('parses fractional hours for 45m TTL', () => {
    process.env.PENDING_ORDER_TTL_HOURS_15M = '0.75';
    expect(getPendingOrderTtlHours('15m')).toBe(0.75);
  });

  it('parses drift pct', () => {
    process.env.PENDING_ORDER_DRIFT_PCT = '0.01';
    expect(getPendingOrderMaxDriftPct()).toBe(0.01);
  });
});
