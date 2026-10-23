export declare function createTradingSnapshots(): Promise<void>;
export declare function runDataRetention(retentionDaysPriceHistory: number, retentionDaysOhlcv: number): Promise<{
    priceHistoryDeleted: number;
    ohlcvDeleted: number;
}>;
//# sourceMappingURL=runtime-maintenance.d.ts.map