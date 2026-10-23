/**
 * Shared logic for Binance order fill price resolution and pending → position materialization.
 */
import { getTestnetPendingOrderByBinanceId } from '../repositories/testnet.repository';
import { type ProtectivePlacementOutcome } from './protective-order.service';
/** Binance ORDER_TRADE_UPDATE `o` payload (subset). */
export interface BinanceOrderTradeUpdate {
    z?: string;
    Z?: string;
    ap?: string;
    L?: string;
    p?: string;
}
export declare function resolveFillAvgPrice(order: BinanceOrderTradeUpdate, executedQty: number, fallbackEntryPrice?: number): number;
export declare function resolveFillQty(order: BinanceOrderTradeUpdate, executedQty: number): number;
/** Reconciliation may only materialize a fill this recent (WS miss window). Older = mark executed, no position. */
export declare const RECOVERY_FILL_MAX_AGE_MS: number;
export interface MaterializeFillOptions {
    suppressTelegram?: boolean;
    reconciliationBackfill?: boolean;
}
/** Skip duplicate "Mở vị thế" when WS already notified before a recovery pass. */
export declare function hasEntryFillBeenNotified(orderId: string): Promise<boolean>;
/**
 * Create open position from a filled pending order and place SL/TP on Binance.
 */
export declare function materializePositionFromPendingFill(localOrder: {
    order_id: string;
    account_id: number;
    symbol: string;
    side: string;
    stop_loss: number;
    take_profit: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id?: number | null;
    binance_order_id?: string | null;
    entry_price?: number;
    status?: string;
}, executedQty: number, avgPrice: number, eventTime?: number, options?: MaterializeFillOptions): Promise<string | null>;
/**
 * Place SL/TP on Binance when missing (fill handler + reconciliation).
 */
export declare function ensureProtectiveOrdersForPosition(position: {
    position_id: string;
    account_id?: number;
    symbol: string;
    side: string;
    entry_price?: number;
    size_qty: number;
    stop_loss: number;
    take_profit: number;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
    account?: {
        current_balance?: number;
    };
}): Promise<ProtectivePlacementOutcome>;
/**
 * Recover a single pending row using Binance order query (reconciliation / repair).
 */
export declare function recoverPendingOrderFromBinance(localOrder: {
    order_id: string;
    account_id: number;
    symbol: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id?: number | null;
    binance_order_id?: string | null;
    status: string;
}): Promise<'filled' | 'cancelled' | 'unchanged' | 'failed' | 'api_unavailable' | 'stale_skipped'>;
/** Parse x-v3_<ts>_<suffix> → v3_<ts>_<suffix> */
export declare function parseV3ClientOrderId(clientOrderId: string | undefined): string | null;
export declare function findLocalOrderForBinanceEvent(binanceOrderId: string, symbolUsdt: string, clientOrderId?: string): Promise<Awaited<ReturnType<typeof getTestnetPendingOrderByBinanceId>>>;
//# sourceMappingURL=binance-order-fill.service.d.ts.map