/**
 * Validate and apply LLM pending_order_decisions (hold / cancel / modify).
 */
/** Pure age gate for AI cancel (minutes). */
export declare function isPendingTooYoungForAiCancel(createdAt: Date | string, nowMs: number, minAgeMinutes: number): boolean;
export interface PendingOrderDecision {
    order_id: string;
    action: 'hold' | 'cancel' | 'modify';
    confidence: number;
    reason: string;
    new_entry?: number | null;
    new_sl?: number | null;
    new_tp?: number | null;
}
export declare function parsePendingOrderDecisions(raw: unknown): PendingOrderDecision[];
export interface ApplyPendingDecisionsResult {
    processed: number;
    cancelled: number;
    modified: number;
    held: number;
    skipped: number;
}
export declare function applyPendingOrderDecisions(decisions: PendingOrderDecision[], minConfidence: number): Promise<ApplyPendingDecisionsResult>;
//# sourceMappingURL=pending-order-decisions.d.ts.map