import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPendingOrderTtlHours,
  getPendingOrderMaxDriftPct,
} from '../../src/config/pending-order-policy';

describe('pending-order-policy', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('returns default TTL by timeframe', () => {
    expect(getPendingOrderTtlHours('15m')).toBe(6);
    expect(getPendingOrderTtlHours('1h')).toBe(24);
    expect(getPendingOrderTtlHours(null)).toBe(48);
  });

  it('respects env overrides', () => {
    process.env.PENDING_ORDER_TTL_HOURS_15M = '8';
    process.env.PENDING_ORDER_TTL_MAX_HOURS = '12';
    expect(getPendingOrderTtlHours('15m')).toBe(8);
    expect(getPendingOrderTtlHours('1h')).toBe(12);
  });

  it('parses drift pct', () => {
    process.env.PENDING_ORDER_DRIFT_PCT = '0.01';
    expect(getPendingOrderMaxDriftPct()).toBe(0.01);
  });
});
