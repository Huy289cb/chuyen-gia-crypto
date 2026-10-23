/** Worst planned stop loss including fees and an explicit slippage reserve (not a guaranteed max loss). */
export declare function computeExecutionRisk(input: {
    entry: number;
    stopLoss: number;
    quantity: number;
    balance: number;
    roundTripFeePercent?: number;
    slippagePercent?: number;
}): {
    priceRiskUsd: number;
    feeReserveUsd: number;
    slippageReserveUsd: number;
    totalRiskUsd: number;
    riskPercent: number;
};
/** Fixed USD mode is explicit; otherwise retain the existing wallet-percent ceiling. */
export declare function resolveExecutionRiskCapUsd(input: {
    balance: number;
    maxRiskPercent: number;
    maxRiskUsd?: number | null;
}): number;
//# sourceMappingURL=execution-risk.d.ts.map