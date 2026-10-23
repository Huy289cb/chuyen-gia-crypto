/**
 * Swing-structure bias: HH+HL → bull, LH+LL → bear, else transition.
 * Fractal pivots (left/right bars). Pure — no I/O.
 */
export type StructureBias = 'bull' | 'bear' | 'transition';
export interface StructureCandle {
    high: number;
    low: number;
    close?: number;
    timestamp?: number;
}
export interface StructureSwing {
    kind: 'high' | 'low';
    price: number;
    index: number;
}
export interface StructureBiasResult {
    bias: StructureBias;
    swingHighs: number[];
    swingLows: number[];
    reason: string;
}
/** Fractal pivots: high/low extreme vs `strength` bars each side. */
export declare function findStructureSwings(candles: StructureCandle[], strength?: number): StructureSwing[];
/**
 * Classify from last two swing highs + last two swing lows.
 * Equal highs/lows → transition (strict).
 */
export declare function classifyStructureBias(candles: StructureCandle[], opts?: {
    strength?: number;
}): StructureBiasResult;
/**
 * Bearish BOS: last close below prior swing low (l0).
 * LH+LL alone is often a pullback wick — short needs confirmed break, not reclaim.
 */
export declare function hasBearishStructureBreak(detail: Pick<StructureBiasResult, 'swingLows'>, lastClose: number): boolean;
/**
 * Bullish BOS: last close above prior swing high (h0).
 * HH+HL alone is often a relief rally in bear — long needs confirmed break, not reject.
 */
export declare function hasBullishStructureBreak(detail: Pick<StructureBiasResult, 'swingHighs'>, lastClose: number): boolean;
//# sourceMappingURL=structure-bias.d.ts.map