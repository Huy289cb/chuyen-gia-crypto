/**
 * Independent P0 guard: live Binance exposure must have exchange-side SL.
 */
import type { ParsedBinancePosition } from '../utils/binance-position-match';
export interface ProtectiveAlgoLike {
    symbol?: string;
    side?: string;
    type?: string;
    orderType?: string;
    algoId?: string | number;
    orderId?: string | number;
    quantity?: number;
    origQty?: number;
    positionSide?: string;
}
export interface ProtectiveCoverage {
    stopLossId: string | null;
    takeProfitId: string | null;
    stopLossCount: number;
    takeProfitCount: number;
}
export { protectiveAuditStartupDelayMs } from './position-lifecycle-guard.service';
export declare function classifyProtectiveCoverage(position: ParsedBinancePosition, orders: ProtectiveAlgoLike[]): ProtectiveCoverage;
export declare function auditProtectiveCoverageForSymbol(symbol: string): Promise<{
    checked: number;
    repaired: number;
    closed: number;
    blocked: boolean;
}>;
export declare function auditProtectiveCoverageForSymbols(symbols: string[]): Promise<void>;
//# sourceMappingURL=protective-exposure-audit.service.d.ts.map