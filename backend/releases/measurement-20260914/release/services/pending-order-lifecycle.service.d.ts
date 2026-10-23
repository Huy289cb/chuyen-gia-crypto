/**
 * Expire stale limit pending orders (TTL + price drift) and free pipeline capacity.
 */
import { type PendingCancelReason } from './pending-order-actions';
export type { PendingCancelReason };
export interface PendingLifecycleResult {
    reviewed: number;
    cancelled: number;
    reasons: Array<{
        order_id: string;
        reason: PendingCancelReason;
    }>;
}
/**
 * Review all pending limit orders: cancel on TTL or adverse price drift.
 */
export declare function runPendingOrderLifecycle(symbol?: string): Promise<PendingLifecycleResult>;
//# sourceMappingURL=pending-order-lifecycle.service.d.ts.map