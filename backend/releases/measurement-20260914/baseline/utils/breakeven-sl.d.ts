/**
 * Breakeven SL slightly into profit so a stop fill covers fees.
 * Default ~0.08% ≈ futures round-trip taker on both legs.
 */
export type BeSide = 'long' | 'short';
export declare function feeAwareBreakevenSl(side: BeSide, entry: number, feeBufferPct: number): number;
//# sourceMappingURL=breakeven-sl.d.ts.map