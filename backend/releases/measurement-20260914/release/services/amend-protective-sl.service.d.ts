/**
 * Shared amend of exchange STOP + local stop_loss (profit-protect / invalidation).
 */
export interface AmendStopLossPosition {
    position_id: string;
    symbol: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    size_qty: number;
    binance_sl_order_id?: string | null;
}
export declare function amendProtectiveStopLoss(input: {
    position: AmendStopLossPosition;
    newSl: number;
    mark: number;
    eventType: string;
    action: string;
    reason: string;
    meta?: Record<string, unknown>;
}): Promise<{
    ok: boolean;
    reason: string;
    newSlId?: string;
}>;
//# sourceMappingURL=amend-protective-sl.service.d.ts.map