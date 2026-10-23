export interface RealtimeCandle {
    price: number;
    high: number;
    low: number;
}
export declare function syncTestnetForSymbol(symbol: string, candle: RealtimeCandle): Promise<void>;
//# sourceMappingURL=testnet-sync.d.ts.map