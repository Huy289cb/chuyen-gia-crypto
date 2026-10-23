/**
 * Periodic review of unfilled limit pending orders (TTL + drift).
 */
export declare function startPendingOrderScheduler(cronExpression?: string): void;
export declare function stopPendingOrderScheduler(): void;
export declare function runManualPendingOrderReview(): Promise<void>;
//# sourceMappingURL=pending-order.scheduler.d.ts.map