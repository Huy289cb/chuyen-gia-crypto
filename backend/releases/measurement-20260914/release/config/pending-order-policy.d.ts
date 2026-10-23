/**
 * TTL and drift rules for unfilled limit pending orders (PnL+ lifecycle).
 * Short TTL on 5m/15m — long limits fill late into dead breakouts (e.g. 128m → SL).
 */
export declare function getPendingOrderTtlHours(timeframe: string | null | undefined): number;
export declare function getPendingOrderMaxDriftPct(): number;
export declare function isPendingOrderLifecycleEnabled(): boolean;
export declare const PENDING_ORDER_LIFECYCLE_CRON: string;
export declare function isPendingOrderReviewEnabled(): boolean;
/** Min LLM confidence to cancel/modify (default 0.85 — match review prompt). */
export declare function getPendingOrderReviewMinConfidence(): number;
/** Do not AI-cancel a limit younger than this (default 60m). TTL/drift still apply. */
export declare function getPendingOrderReviewMinAgeMinutes(): number;
/**
 * After any pending cancel, block new place for this many minutes (default 45).
 * Stops Telegram place→cancel→place churn when LLM still likes the setup.
 */
export declare function getPendingOrderReentryCooldownMinutes(): number;
/**
 * After any closed position, block re-entry on either side (anti-chase / anti-flip).
 * Default 90m after close/win. After a loss: POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES (default 360m / 6h).
 * Env names keep SAME_SIDE for compat; behavior is any-side.
 */
export declare function getPostCloseSameSideCooldownMinutes(wasLoss: boolean): number;
//# sourceMappingURL=pending-order-policy.d.ts.map