/**
 * Human-readable next-fire hint for the minute/second cron forms used by the
 * worker. node-cron accepts both five-field and six-field expressions; in the
 * six-field form the first field is seconds, not minutes.
 */
export declare function estimateNextCronHint(last: Date | null, cronExpr: string, now?: Date): string;
//# sourceMappingURL=cron-next-run.d.ts.map