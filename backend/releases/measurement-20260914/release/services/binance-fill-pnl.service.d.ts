import { type ExchangeRound } from '../utils/exchange-rounds';
export type { ExchangeFill as UserTradeRow } from '../utils/exchange-rounds';
export interface FillPnlResolution {
    closePrice: number;
    realizedPnl: number;
    closeQty: number;
    tradeIds: number[];
    verified: boolean;
    source: 'user_trades' | 'mark_estimate';
    entryFee?: number;
    exitFee?: number;
    fundingFee?: number;
    round?: ExchangeRound;
}
export declare function resolveClosePnlFromUserTrades(params: {
    symbol: string;
    side: string;
    entryTime: Date;
    closeTime?: Date;
    entryOrderId?: string | null;
    sizeQty: number;
    entryPrice: number;
    fallbackClosePrice: number;
    /** Reuse one complete exchange snapshot for a reconciliation batch. */
    rounds?: ExchangeRound[];
}): Promise<FillPnlResolution>;
export declare function estimatePnl(side: string, entry: number, close: number, qty: number): number;
//# sourceMappingURL=binance-fill-pnl.service.d.ts.map