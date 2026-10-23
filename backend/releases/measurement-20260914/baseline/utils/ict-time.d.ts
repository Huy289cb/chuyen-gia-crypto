/**
 * Day/week boundaries in Vietnam time (Asia/Ho_Chi_Minh, UTC+7, no DST).
 */
/** ICT calendar date as YYYY-MM-DD for `reference`. */
export declare function getIctDateString(reference?: Date): string;
/** Start of ICT calendar day as UTC Date. */
export declare function getIctDayStart(reference?: Date): Date;
/** Start of ICT day 7 days before today's ICT midnight. */
export declare function getIctWeekStart(reference?: Date): Date;
export declare function getDayBoundsICT(reference?: Date): {
    dayStart: Date;
    weekStart: Date;
};
//# sourceMappingURL=ict-time.d.ts.map