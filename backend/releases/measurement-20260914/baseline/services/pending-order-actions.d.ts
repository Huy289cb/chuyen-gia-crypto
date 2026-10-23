/**
 * Shared Binance + DB actions for pending limit orders.
 */
export type PendingCancelReason = 'ttl_expired' | 'price_drift' | 'manual' | 'ai_review';
export declare function isPendingOrderTerminal(status: string | null | undefined): boolean;
export declare function resolveTimeframeForPendingOrder(orderId: string): Promise<string | null>;
export declare function cancelPendingOnExchangeAndDb(order: {
    order_id: string;
    symbol: string;
    binance_order_id?: string | null;
    status?: string;
}, reason: PendingCancelReason): Promise<void>;
//# sourceMappingURL=pending-order-actions.d.ts.map