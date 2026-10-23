/**
 * LLM review of unfilled limit pending orders (hold / cancel / modify).
 * Runs when pending exists — does not block new-trade dispatch path.
 */
export interface PendingReviewResult {
    reviewed: number;
    llmCalled: boolean;
    cancelled: number;
    modified: number;
    held: number;
    skipped: number;
}
/**
 * Ask LLM to review pending limits; apply cancel/modify when confidence passes threshold.
 */
export declare function runPendingOrderReview(symbol?: string): Promise<PendingReviewResult>;
//# sourceMappingURL=pending-order-review.service.d.ts.map