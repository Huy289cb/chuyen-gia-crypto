import { describe, expect, it } from 'vitest';
import { isPendingTooYoungForAiCancel } from '../../src/utils/pending-order-decisions';

describe('isPendingTooYoungForAiCancel', () => {
  const now = Date.parse('2026-07-18T17:30:00.000Z');

  it('blocks cancel when younger than min age', () => {
    const created = new Date(now - 10 * 60_000); // 10m
    expect(isPendingTooYoungForAiCancel(created, now, 60)).toBe(true);
  });

  it('allows cancel when older than min age', () => {
    const created = new Date(now - 90 * 60_000); // 90m
    expect(isPendingTooYoungForAiCancel(created, now, 60)).toBe(false);
  });

  it('allows when min age disabled', () => {
    const created = new Date(now - 1_000);
    expect(isPendingTooYoungForAiCancel(created, now, 0)).toBe(false);
  });
});
