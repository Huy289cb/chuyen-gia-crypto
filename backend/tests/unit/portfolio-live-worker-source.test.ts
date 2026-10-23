import { describe, expect, it } from 'vitest';
import { liveDailySourceWindowOpen, liveSourcePreparationNeeded } from '../../src/portfolio/live-worker';

const utcMs = Date.UTC(2026, 9, 18);
const dayMs = 86_400_000;
const input = (extra: Partial<Parameters<typeof liveSourcePreparationNeeded>[0]> = {}) => ({
  nowMs: utcMs + 10_000, utcMs, sourceCursorMs: utcMs - dayMs,
  technicalRecovery: false, pending: false, ...extra,
});

describe('live worker causal source preparation', () => {
  it('prepares a new daily row during its existing first-minute window', () => {
    expect(liveSourcePreparationNeeded(input())).toBe(true);
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs + 60_000 }))).toBe(false);
  });

  it('does not replay a consumed source or extend an ordinary daily window', () => {
    expect(liveSourcePreparationNeeded(input({ sourceCursorMs: utcMs }))).toBe(false);
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs + 8 * 3_600_000 }))).toBe(false);
  });

  it('prepares the current causal daily row after a technical exit even when already consumed', () => {
    expect(liveSourcePreparationNeeded(input({ sourceCursorMs: utcMs,
      nowMs: utcMs + 8 * 3_600_000, technicalRecovery: true }))).toBe(true);
  });

  it('keeps a public history job in the background without creating overlapping jobs', () => {
    expect(liveSourcePreparationNeeded(input({ technicalRecovery: true, pending: true }))).toBe(false);
  });

  it('reuses the durable prepared current row without another fetch', () => {
    expect(liveSourcePreparationNeeded(input({ technicalRecovery: true,
      preparedUtcMs: utcMs, nowMs: utcMs + 8 * 3_600_000 }))).toBe(false);
  });

  it('retries a failed recovery source at a bounded minute cadence', () => {
    const failed = input({ sourceCursorMs: utcMs, technicalRecovery: true,
      lastAttemptUtcMs: utcMs, lastAttemptAtMs: utcMs + 100_000 });
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 159_999 })).toBe(false);
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 160_000 })).toBe(true);
  });

  it('retries an ordinary failed fetch after ten seconds within the original window', () => {
    const failed = input({ lastAttemptUtcMs: utcMs, lastAttemptAtMs: utcMs + 1_000 });
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 10_999 })).toBe(false);
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 11_000 })).toBe(true);
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 60_000 })).toBe(false);
  });

  it('rebuilds the next UTC row instead of reusing stale prepared history', () => {
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs + dayMs + 30_000,
      utcMs: utcMs + dayMs, sourceCursorMs: utcMs, preparedUtcMs: utcMs,
      lastAttemptUtcMs: utcMs, technicalRecovery: true }))).toBe(true);
  });

  it('keeps the ordinary cursor pending between a failed job and its next retry', () => {
    const failed = input({ nowMs: utcMs + 2_000, lastAttemptUtcMs: utcMs,
      lastAttemptAtMs: utcMs, pending: false });
    expect(liveSourcePreparationNeeded(failed)).toBe(false);
    expect(liveDailySourceWindowOpen(failed)).toBe(true);
    expect(liveDailySourceWindowOpen({ ...failed, nowMs: utcMs + 59_999 })).toBe(true);
    expect(liveDailySourceWindowOpen({ ...failed, nowMs: utcMs + 60_000 })).toBe(false);
  });

  it('bounds repeated ordinary failures to six starts without extending their window', () => {
    let lastAttemptAtMs: number | undefined;
    const starts: number[] = [];
    for (let elapsed = 0; elapsed <= 120_000; elapsed += 2_000) {
      if (liveSourcePreparationNeeded(input({ nowMs: utcMs + elapsed,
        lastAttemptUtcMs: lastAttemptAtMs === undefined ? undefined : utcMs, lastAttemptAtMs }))) {
        lastAttemptAtMs = utcMs + elapsed;
        starts.push(elapsed);
      }
    }
    expect(starts).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000]);
  });

  it('never overlaps a slow ordinary source job even after the retry interval', () => {
    expect(liveSourcePreparationNeeded(input({ pending: true, nowMs: utcMs + 50_000,
      lastAttemptUtcMs: utcMs, lastAttemptAtMs: utcMs }))).toBe(false);
  });

  it('reuses prepared ordinary targets throughout the same window without a second fetch', () => {
    expect(liveSourcePreparationNeeded(input({ preparedUtcMs: utcMs,
      lastAttemptUtcMs: utcMs, lastAttemptAtMs: utcMs, nowMs: utcMs + 50_000 }))).toBe(false);
  });

  it('allows a restart to prepare an unconsumed row only while its original window is open', () => {
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs + 40_000 }))).toBe(true);
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs + 60_001 }))).toBe(false);
    expect(liveSourcePreparationNeeded(input({ sourceCursorMs: utcMs, nowMs: utcMs + 40_000 }))).toBe(false);
  });

  it('uses the daily retry cadence when technical recovery coincides with a new daily row', () => {
    const failed = input({ technicalRecovery: true, lastAttemptUtcMs: utcMs, lastAttemptAtMs: utcMs });
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 9_999 })).toBe(false);
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 10_000 })).toBe(true);
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 60_001,
      lastAttemptAtMs: utcMs + 50_000 })).toBe(false);
    expect(liveSourcePreparationNeeded({ ...failed, nowMs: utcMs + 110_000,
      lastAttemptAtMs: utcMs + 50_000 })).toBe(true);
  });

  it('starts a new daily retry budget when UTC rolls over after yesterday failed', () => {
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs + dayMs,
      utcMs: utcMs + dayMs, lastAttemptUtcMs: utcMs, lastAttemptAtMs: utcMs + 50_000,
      preparedUtcMs: utcMs }))).toBe(true);
  });

  it('does not consider a future source epoch part of the current daily window', () => {
    expect(liveDailySourceWindowOpen(input({ nowMs: utcMs - 1 }))).toBe(false);
    expect(liveSourcePreparationNeeded(input({ nowMs: utcMs - 1 }))).toBe(false);
  });
});
