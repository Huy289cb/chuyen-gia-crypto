/**
 * Binance Futures Account Module
 *
 * Account-related endpoints for Binance Futures
 */
interface AccountInfo {
    feeTier: number;
    canTrade: boolean;
    canWithdraw: boolean;
    canDeposit: boolean;
    updateTime: number;
    totalInitialMargin: number;
    totalMaintMargin: number;
    totalWalletBalance: number;
    totalUnrealizedProfit: number;
    totalMarginBalance: number;
    totalPositionInitialMargin: number;
    totalOpenOrderInitialMargin: number;
    maxWithdrawAmount: number;
    assets: Array<{
        asset: string;
        walletBalance: number;
        unrealizedProfit: number;
    }>;
    positions: Array<{
        symbol: string;
        positionAmt: number;
        entryPrice: number;
        markPrice: number;
        unRealizedProfit: number;
        liquidationPrice: number;
        leverage: number;
        maxNotionalValue: number;
        marginType: string;
        isolatedMargin: number;
        isAutoAddMargin: boolean;
        positionSide: string;
        notional: number;
        isolatedWallet: number;
    }>;
}
interface BalanceInfo {
    walletBalance: number;
    availableBalance: number;
    crossWalletBalance: number;
    crossUnPnl: number;
    maxWithdrawAmount: number;
    totalWalletBalance: number;
    totalAvailableBalance: number;
    totalUnrealizedProfit: number;
    balances: Array<{
        asset: string;
        balance: number;
        availableBalance: number;
        crossWalletBalance: number;
        crossUnPnl: number;
        maxWithdrawAmount: number;
    }>;
}
interface PositionRisk {
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    markPrice: number;
    unRealizedProfit: number;
    liquidationPrice: number;
    leverage: number;
    maxNotionalValue: number;
    marginType: string;
    isolatedMargin: number;
    isAutoAddMargin: boolean;
    positionSide: string;
    notional: number;
    isolatedWallet: number;
}
/**
 * Get account information
 * @returns {Promise<object>} Account information
 */
export declare function getAccount(): Promise<AccountInfo>;
/**
 * Get account balance
 * @returns {Promise<object>} Balance information
 */
export declare function getBalance(): Promise<BalanceInfo>;
/**
 * Get position risk information
 * @param {string} symbol - Trading symbol (optional)
 * @returns {Promise<Array>} Position risk data
 */
export declare function getPositionRisk(symbol?: string | null): Promise<PositionRisk[]>;
/**
 * Get current position for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<object|null>} Position data or null if no position
 */
export declare function getCurrentPosition(symbol: string): Promise<PositionRisk | null>;
export {};
//# sourceMappingURL=account.d.ts.map