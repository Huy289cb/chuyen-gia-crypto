export declare function isLongSide(side: string): boolean;
/** Normalize qty: DB may store shorts as negative size or positive size + side. */
export declare function signedPositionQty(side: string, sizeQty: number): number;
export declare function calculateUnrealizedPnl(side: string, entryPrice: number, markPrice: number, sizeQty: number): number;
/** Price move % in the position's favor (not ROE on margin). */
export declare function calculatePnlPercent(side: string, entryPrice: number, markPrice: number): number;
/** Latest mark for dashboard / position display: DB latest_price → live fetch → fallback. */
export declare function resolveMarkPrice(symbol: string, fallback: number): Promise<number>;
//# sourceMappingURL=position-mark.d.ts.map