/**
 * Sync testnet account balances from Binance Futures account API (source of truth).
 */
export interface BinanceBalanceSnapshot {
    walletBalance: number;
    unrealizedPnl: number;
    equity: number;
    availableBalance?: number;
}
/**
 * Fetch wallet + equity from Binance /fapi/v2/account (not /balance sum, which double-counts assets).
 */
export declare function fetchBinanceBalanceSnapshot(): Promise<BinanceBalanceSnapshot>;
/**
 * Write Binance wallet/equity into testnet_accounts for one account row.
 * On demo-fapi, balance/account often return -1109 — returns null and keeps local ledger.
 */
export declare function syncTestnetAccountFromBinance(accountId: number): Promise<BinanceBalanceSnapshot | null>;
export declare function syncTestnetAccountBySymbol(symbol: string, methodId: string): Promise<BinanceBalanceSnapshot | null>;
/** Wallet/equity for Telegram trade notifications (syncs from Binance when enabled). */
export declare function resolveTestnetAccountBalances(accountId: number, syncFromBinance?: boolean): Promise<{
    account_balance: number;
    account_equity: number;
}>;
export declare function syncAllTestnetAccountsFromBinance(): Promise<void>;
//# sourceMappingURL=binance-balance-sync.service.d.ts.map