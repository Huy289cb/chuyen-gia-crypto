import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HTF_SCAN_MAX_AGE_MS,
  evaluateScanFreshness,
  getHtfScanMaxAgeMs,
} from '../../src/utils/scan-freshness';

describe('HTF scan freshness', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('accepts a recent timestamp at the max-age boundary', () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const result = evaluateScanFreshness(new Date(now - 10 * 60_000), {
      nowMs: now,
      maxAgeMs: 10 * 60_000,
      label: 'HTF 1h',
    });
    expect(result.pass).toBe(true);
  });

  it('fails closed on a stale timestamp with an explicit reason', () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const result = evaluateScanFreshness(now - 11 * 60_000, {
      nowMs: now,
      maxAgeMs: 10 * 60_000,
      label: 'HTF 1h',
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('HTF 1h scan stale');
  });

  it('fails closed on missing, invalid, and future timestamps', () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    expect(evaluateScanFreshness(undefined, { nowMs: now }).pass).toBe(false);
    expect(evaluateScanFreshness(new Date('invalid'), { nowMs: now }).pass).toBe(false);
    expect(evaluateScanFreshness(now + 1, { nowMs: now }).pass).toBe(false);
  });

  it('uses a guarded env override and safe default', () => {
    process.env.V3_HTF_SCAN_MAX_AGE_MS = '12345';
    expect(getHtfScanMaxAgeMs()).toBe(12345);
    process.env.V3_HTF_SCAN_MAX_AGE_MS = 'invalid';
    expect(getHtfScanMaxAgeMs()).toBe(DEFAULT_HTF_SCAN_MAX_AGE_MS);
  });
});
