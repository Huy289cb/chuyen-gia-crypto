/**
 * Map verified Binance fills to close_reason taxonomy (binance_sl/tp/market).
 */
export interface CloseReasonPositionRef {
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
}
export declare function resolveVerifiedCloseReason(closeReason: string, eventMeta?: Record<string, unknown>, position?: CloseReasonPositionRef): string;
//# sourceMappingURL=close-reason-resolve.service.d.ts.map