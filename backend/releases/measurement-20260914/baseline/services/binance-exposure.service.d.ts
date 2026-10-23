/**
 * Live Binance Futures exposure (source of truth for stacking prevention).
 */
import { type ParsedBinancePosition, type PositionSideLocal } from '../utils/binance-position-match';
/** True when positionRisk returned demo -1109 and fallback sources were used. */
export declare function isBinancePositionRiskUnavailable(): boolean;
/** Reset exposure probe state (tests). */
export declare function clearBinancePositionRiskState(): void;
/**
 * Infer open exposure when positionRisk/account are unavailable on demo (-1109).
 * Uses userTrades net qty, then open algo SL/TP as secondary signal.
 */
export declare function inferBinancePositionsFromFallback(symbol?: string): Promise<ParsedBinancePosition[]>;
export type BinanceExposureFetchOpts = {
    /** When false, return empty on demo -1109 instead of inferring from userTrades net. */
    allowUserTradesFallback?: boolean;
};
export declare function fetchBinancePositionRiskRows(symbol?: string, opts?: BinanceExposureFetchOpts): Promise<Array<{
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    positionSide?: string;
}>>;
export declare function fetchActiveBinancePositions(symbol?: string, opts?: BinanceExposureFetchOpts): Promise<ParsedBinancePosition[]>;
export declare function fetchBinanceNetPosition(symbol: string): Promise<ParsedBinancePosition | null>;
export declare function hasBinanceExposureForSide(symbol: string, side: PositionSideLocal): Promise<boolean>;
//# sourceMappingURL=binance-exposure.service.d.ts.map