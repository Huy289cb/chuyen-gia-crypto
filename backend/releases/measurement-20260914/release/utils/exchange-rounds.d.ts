/** Quantity-based, one-way USDT futures accounting. No price-derived realized PnL. */
export interface ExchangeFill {
    tradeId?: number | string;
    orderId: number | string;
    side: string;
    price: number;
    qty: number;
    commission: number;
    commissionAsset?: string;
    realizedPnl: number;
    time: number;
}
export interface FundingIncome {
    incomeType: string;
    income: string;
    time: number;
    asset?: string;
    tranId?: number | string;
}
export interface ExchangeRound {
    side: 'long' | 'short';
    entryTime: number;
    closeTime: number;
    entryPrice: number;
    closePrice: number;
    quantity: number;
    grossPnl: number;
    entryFee: number;
    exitFee: number;
    /** Signed cost: positive when paid, negative when received. */
    fundingFee: number;
    netPnl: number;
    fills: ExchangeFill[];
    funding: FundingIncome[];
}
export declare function reconstructExchangeRounds(fills: ExchangeFill[], income?: FundingIncome[]): ExchangeRound[];
//# sourceMappingURL=exchange-rounds.d.ts.map