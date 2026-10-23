/**
 * Position invalidation — structure-based tighten / red exit.
 * See docs/position-invalidation-plan.md
 */
/** Master switch — default on. */
export declare function isInvalidationEnabled(): boolean;
/**
 * When score≥min, market-exit (green or red). Default on.
 * Invalidation no longer tightens to BE — thesis dead → flat.
 */
export declare function isInvalidationExitEnabled(): boolean;
export declare function getInvalidationMinScore(): number;
export declare function getInvalidationMinMinutes(): number;
/** Require at least this unrealized % before BE tighten. */
export declare function getInvalidationMinUpnlPct(): number;
/** Soft signal: HTF lost trend after this many hours + weak R. */
export declare function getInvalidationHtfLostMinHours(): number;
export declare function getInvalidationCooldownMs(): number;
/** Primary TF for HTF regime / trendDirection (default 1h). */
export declare function getInvalidationHtfTf(): string;
/** Secondary TF for adverse sweep/breakout (default 15m). */
export declare function getInvalidationLtfTf(): string;
//# sourceMappingURL=position-invalidation-policy.d.ts.map