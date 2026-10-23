/**
 * Normalize Binance positionRisk rows for ONE_WAY (positionSide BOTH) and HEDGE modes.
 */
export type PositionSideLocal = 'long' | 'short';
export interface ParsedBinancePosition {
    symbol: string;
    symbolUsdt: string;
    side: PositionSideLocal;
    positionAmt: number;
    entryPrice: number;
    markPrice: number;
    /** From Binance positionRisk unRealizedProfit when available. */
    unRealizedProfit?: number;
    /** Signed notional USDT from Binance when available. */
    notional?: number;
    rawPositionSide: string;
}
export declare function localSideFromPositionAmt(amt: number): PositionSideLocal | null;
export declare function parseBinancePositionRisk(row: {
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    unRealizedProfit?: string | number;
    notional?: string | number;
    positionSide?: string;
}): ParsedBinancePosition | null;
export declare function findBinancePositionForSide(rows: Array<{
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    positionSide?: string;
}>, symbol: string, side: PositionSideLocal): ParsedBinancePosition | null;
export declare function listActiveBinancePositions(rows: Array<{
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    positionSide?: string;
}>): ParsedBinancePosition[];
//# sourceMappingURL=binance-position-match.d.ts.map