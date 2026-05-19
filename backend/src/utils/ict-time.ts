/**
 * Day/week boundaries in Vietnam time (Asia/Ho_Chi_Minh, UTC+7, no DST).
 */

const TZ = 'Asia/Ho_Chi_Minh';

/** ICT calendar date as YYYY-MM-DD for `reference`. */
export function getIctDateString(reference: Date = new Date()): string {
  return reference.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Start of ICT calendar day as UTC Date. */
export function getIctDayStart(reference: Date = new Date()): Date {
  const dateStr = getIctDateString(reference);
  return new Date(`${dateStr}T00:00:00+07:00`);
}

/** Start of ICT day 7 days before today's ICT midnight. */
export function getIctWeekStart(reference: Date = new Date()): Date {
  const dayStart = getIctDayStart(reference);
  const week = new Date(dayStart);
  week.setUTCDate(week.getUTCDate() - 7);
  return week;
}

export function getDayBoundsICT(reference: Date = new Date()): {
  dayStart: Date;
  weekStart: Date;
} {
  return {
    dayStart: getIctDayStart(reference),
    weekStart: getIctWeekStart(reference),
  };
}
