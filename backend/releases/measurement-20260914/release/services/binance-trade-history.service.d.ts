/**
 * Closed trade rounds reconstructed from Binance Futures userTrades (source of truth).
 */
import { type ExchangeFill as UserTradeRow } from '../utils/exchange-rounds';
export interface BinanceTradeRound {
    id: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    closePrice: number;
    quantity: number;
    fee: number;
    realizedPnL: number;
    closeReason: string;
    status: 'closed';
    closedAt: string;
    openedAt?: string;
    fundingFee?: number;
    netPnl?: number;
}
export interface BinanceTradeHistoryFetchOptions {
    nowMs?: number;
    lookbackMs?: number;
    cacheTtlMs?: number;
}
export declare function fetchUserTradesByTimeWindows(symbolUsdt: string, nowMs: number, lookbackMs?: number): Promise<UserTradeRow[]>;
export declare function clearBinanceTradeHistoryCacheForTests(): void;
/** Only completed, flat-to-flat rounds belong in the closed history. */
export declare function aggregateUserTradesToRounds(trades: UserTradeRow[], symbol: string): BinanceTradeRound[];
export interface BinanceLossStreak {
    /** Number of most-recent consecutive losing rounds (net of fees). */
    consecutiveLosses: number;
    /** Epoch ms of the most recent losing round, 0 if none. */
    lastLossTime: number;
}
/** Count leading consecutive losing rounds (net of fees). Rounds must be newest-first. */
export declare function computeLossStreakFromRounds(rounds: BinanceTradeRound[]): BinanceLossStreak;
/**
 * Loss streak from Binance closed rounds (source of truth). Used by the risk
 * guard because DB consecutive_losses freezes when positions close as
 * reconciliation bookkeeping (PnL=0).
 */
export declare function getBinanceLossStreak(symbol: string, lookback?: number): Promise<BinanceLossStreak>;
export declare function fetchBinanceClosedTradeRounds(symbol: string, limit?: number, options?: BinanceTradeHistoryFetchOptions): Promise<BinanceTradeRound[]>;
//# sourceMappingURL=binance-trade-history.service.d.ts.map