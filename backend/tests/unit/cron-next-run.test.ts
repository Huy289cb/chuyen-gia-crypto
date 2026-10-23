import { describe, expect, it } from 'vitest';
import { estimateNextCronHint } from '../../src/utils/cron-next-run';

describe('estimateNextCronHint', () => {
  const last = new Date('2026-09-03T08:25:05.000Z');

  it('treats the first field of a six-field node-cron expression as seconds', () => {
    expect(
      estimateNextCronHint(last, '5 */5 * * * *', new Date('2026-09-03T08:25:06.000Z'))
    ).toBe('~5 min');
  });

  it('reports a six-field fire within one minute when appropriate', () => {
    expect(
      estimateNextCronHint(last, '5 */5 * * * *', new Date('2026-09-03T08:29:50.000Z'))
    ).toBe('within 1 min');
  });

  it('supports the five-field minute cron used by position monitor', () => {
    expect(
      estimateNextCronHint(last, '*/1 * * * *', new Date('2026-09-03T08:25:27.000Z'))
    ).toBe('within 1 min');
  });

  it('returns an em dash when no run has been observed', () => {
    expect(estimateNextCronHint(null, '5 */5 * * * *')).toBe('—');
  });
});
