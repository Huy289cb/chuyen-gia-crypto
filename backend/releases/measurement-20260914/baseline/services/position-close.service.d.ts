/**
 * Close local testnet positions and optionally mirror closes on Binance.
 */
/** Close reasons when protective SL/TP placement fails or price already past levels. */
export declare const PROTECTIVE_CLOSE_REASON: {
    readonly SL_BREACHED: "protective_sl_breached_market";
    readonly TP_REACHED: "protective_tp_reached_market";
    readonly FAILED: "protective_failed_market_close";
};
export type ProtectiveCloseReason = (typeof PROTECTIVE_CLOSE_REASON)[keyof typeof PROTECTIVE_CLOSE_REASON];
export { hasBinanceFillProof } from '../utils/binance-fill-proof';
export declare function calculatePnl(side: string, entry: number, close: number, qty: number): number;
/**
 * Close duplicate DB row when consolidating exposure (records PnL + outcome).
 */
export declare function closeDuplicateForMerge(positionId: string, primaryPositionId: string): Promise<void>;
export declare function findOpenPositionByBinanceOrderId(binanceOrderId: string): Promise<any | null>;
/**
 * Close DB position, update account stats, record event.
 */
export declare function closeLocalPosition(position: {
    position_id: string;
    account_id: number;
    side: string;
    entry_price: number;
    entry_time?: Date;
    size_qty: number;
    stop_loss?: number;
    take_profit?: number;
    expected_rr?: number;
    risk_usd?: number;
    entry_fee?: number;
    exit_fee?: number;
    funding_fee?: number;
    symbol?: string;
    status?: string;
    binance_order_id?: string | null;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
    account: {
        current_balance: number;
    };
}, closePrice: number, closeReason: string, eventMeta?: Record<string, unknown>): Promise<number>;
/**
 * Market-close on Binance (full or partial qty).
 */
export interface BinanceCloseResult {
    ok: boolean;
    reason?: string;
    normalizedQty?: number;
}
export interface BinanceMarketCloseOptions {
    guardSource?: string;
    bypassLifecycleGuard?: boolean;
    positionId?: string;
    entryTime?: Date | null;
}
export declare function closePositionOnBinanceMarket(position: {
    symbol: string;
    side: string;
    size_qty: number;
}, closeQty?: number, options?: BinanceMarketCloseOptions): Promise<BinanceCloseResult>;
export declare function closeOpenPositionFromBinanceFill(binanceOrderId: string, orderType: string, executedQty: number, avgPrice: number, _symbolUsdt: string): Promise<boolean>;
/**
 * Sync ACCOUNT_UPDATE when Binance reports zero position amount.
 */
export declare function syncClosedPositionsFromAccountUpdate(positions: Array<{
    s?: string;
    pa?: string;
    ps?: string;
}>): Promise<void>;
//# sourceMappingURL=position-close.service.d.ts.map