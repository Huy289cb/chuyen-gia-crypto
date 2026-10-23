/** Testnet: limit pending placed (open path). */
export declare function hookPendingOrderPlaced(input: {
    symbol: string;
    side: string;
    timeframe: string;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    sizeQty?: number;
    sizeUsd?: number;
    accountBalance?: number;
    orderId?: string;
    binanceOrderId?: string;
}): void;
/** Testnet: pending order cancelled before fill. */
export declare function hookPendingCancelled(symbol: string, orderId: string, reason?: string): void;
//# sourceMappingURL=telegram-hooks.d.ts.map