import { describe, it, expect } from 'vitest';
import { getDayBoundsICT, getIctDateString, getIctDayStart } from './ict-time';

describe('ict-time', () => {
  it('getIctDayStart returns +07 offset midnight', () => {
    const ref = new Date('2026-05-19T10:00:00+07:00');
    const start = getIctDayStart(ref);
    expect(start.toISOString()).toBe('2026-05-18T17:00:00.000Z');
  });

  it('getIctDateString uses Vietnam calendar', () => {
    const ref = new Date('2026-05-18T20:00:00Z');
    expect(getIctDateString(ref)).toBe('2026-05-19');
  });

  it('weekStart is 7 days before dayStart', () => {
    const ref = new Date('2026-05-19T12:00:00+07:00');
    const { dayStart, weekStart } = getDayBoundsICT(ref);
    const diffDays = (dayStart.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7);
  });
});
