/**
 * P1.6 — Protective orders: recompute SL/TP from actual fill, handle -2021, emergency close.
 */
export interface SlTpLevels {
    stop_loss: number;
    take_profit: number;
}
export type ProtectiveAction = 'place_sl_tp' | 'close_at_market_loss' | 'close_at_market_profit' | 'recompute_and_place';
export type ProtectivePlacementOutcome = 'ok' | 'partial' | 'closed' | 'skipped';
export declare function isPastStopLoss(side: 'long' | 'short', stop_loss: number, mark: number): boolean;
export declare function isPastTakeProfit(side: 'long' | 'short', take_profit: number, mark: number): boolean;
export declare function tpInvalidForMark(side: string, take_profit: number, mark: number): boolean;
/**
 * Decide protective action from planned/recomputed levels vs current mark.
 */
export declare function evaluateProtectiveAction(params: {
    side: 'long' | 'short';
    stop_loss: number;
    take_profit: number;
    mark: number;
    levels?: SlTpLevels;
}): ProtectiveAction;
export declare function isOrderWouldTriggerImmediatelyError(error: unknown): boolean;
/**
 * Recompute SL/TP from fill price while preserving planned risk distance and R:R.
 */
export declare function recomputeSlTpFromFill(params: {
    side: 'long' | 'short';
    fillPrice: number;
    plannedEntry: number;
    plannedSl: number;
    plannedTp: number;
    markPrice?: number;
    minSlDistancePercent?: number;
}): SlTpLevels;
export declare function extractOpenAlgoOrderIds(orders: unknown): Set<string>;
/** Fetch live algo order ids; empty set on failure (treat DB ids as stale). */
export declare function fetchOpenAlgoOrderIds(symbol: string): Promise<Set<string>>;
/**
 * Clear DB SL/TP ids that no longer exist on Binance (e.g. after demo wallet reset).
 */
export declare function reconcileStaleProtectiveOrderIds(position: {
    position_id: string;
    symbol: string;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
}): Promise<{
    binance_sl_order_id: string | null;
    binance_tp_order_id: string | null;
    clearedSl: boolean;
    clearedTp: boolean;
}>;
/**
 * Place or repair SL/TP; market-close if SL cannot be placed safely.
 */
export declare function placeProtectiveOrdersForPosition(position: {
    position_id: string;
    account_id?: number;
    symbol: string;
    side: string;
    entry_price: number;
    size_qty: number;
    stop_loss: number;
    take_profit: number;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
    account?: {
        current_balance?: number;
    };
}): Promise<ProtectivePlacementOutcome>;
export declare function emergencyMarketCloseUnhedged(position: {
    position_id: string;
    account_id?: number;
    symbol: string;
    side: string;
    size_qty: number;
    entry_price: number;
    account?: {
        current_balance?: number;
    };
}, closePrice: number, eventReason?: string, closeReason?: 'protective_sl_breached_market' | 'protective_tp_reached_market' | 'protective_failed_market_close'): Promise<boolean>;
/** Planned SL/TP still valid relative to actual fill (long: SL < fill < TP; short: TP < fill < SL). */
export declare function arePlannedLevelsValidForFill(side: 'long' | 'short', fillPrice: number, plannedSl: number, plannedTp: number): boolean;
/** Levels for a new fill before DB insert — preserve pending SL/TP when still valid for fill. */
export declare function resolveLevelsForFill(side: string, fillPrice: number, plannedEntry: number, plannedSl: number, plannedTp: number, markPrice?: number): SlTpLevels;
//# sourceMappingURL=protective-order.service.d.ts.map