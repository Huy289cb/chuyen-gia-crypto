"use strict";
/**
 * Day/week boundaries in Vietnam time (Asia/Ho_Chi_Minh, UTC+7, no DST).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIctDateString = getIctDateString;
exports.getIctDayStart = getIctDayStart;
exports.getIctWeekStart = getIctWeekStart;
exports.getDayBoundsICT = getDayBoundsICT;
const TZ = 'Asia/Ho_Chi_Minh';
/** ICT calendar date as YYYY-MM-DD for `reference`. */
function getIctDateString(reference = new Date()) {
    return reference.toLocaleDateString('en-CA', { timeZone: TZ });
}
/** Start of ICT calendar day as UTC Date. */
function getIctDayStart(reference = new Date()) {
    const dateStr = getIctDateString(reference);
    return new Date(`${dateStr}T00:00:00+07:00`);
}
/** Start of ICT day 7 days before today's ICT midnight. */
function getIctWeekStart(reference = new Date()) {
    const dayStart = getIctDayStart(reference);
    const week = new Date(dayStart);
    week.setUTCDate(week.getUTCDate() - 7);
    return week;
}
function getDayBoundsICT(reference = new Date()) {
    return {
        dayStart: getIctDayStart(reference),
        weekStart: getIctWeekStart(reference),
    };
}
//# sourceMappingURL=ict-time.js.map