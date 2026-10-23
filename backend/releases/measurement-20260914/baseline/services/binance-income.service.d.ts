/**
 * Binance Futures income history (/fapi/v1/income) — source of truth for wallet PnL.
 */
export interface BinanceIncomeSummary {
    realizedPnl: number;
    commission: number;
    fundingFee: number;
    transferNet: number;
    /** REALIZED_PNL + COMMISSION + FUNDING_FEE (excludes TRANSFER). */
    netTradingPnl: number;
    rowCount: number;
}
export interface IncomeRow {
    incomeType: string;
    income: string;
    time: number;
    asset?: string;
    symbol?: string;
    tranId?: number | string;
}
export interface IncomeOptions {
    symbol?: string;
    startTime?: number;
    endTime?: number;
}
/** Stable bounds + page pagination preserve multiple incomes at the same millisecond. */
export declare function fetchBinanceIncomeRows(options?: IncomeOptions): Promise<IncomeRow[]>;
export declare function fetchBinanceIncomeSummary(options?: IncomeOptions): Promise<BinanceIncomeSummary>;
/**
 * Derive funding baseline: wallet minus trading PnL/fees (excludes demo TRANSFER top-ups).
 */
export declare function deriveWalletBaseline(walletBalance: number, income: BinanceIncomeSummary): number;
//# sourceMappingURL=binance-income.service.d.ts.map