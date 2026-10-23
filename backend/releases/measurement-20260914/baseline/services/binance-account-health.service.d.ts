/**
 * Binance Futures account tradability probe.
 *
 * On Binance Demo (demo-fapi.binance.com), balance/account/positionRisk often return -1109
 * even when order placement works. Use a trading probe instead of getBalance().
 */
export declare const BINANCE_INVALID_ACCOUNT_CODE = -1109;
/** Record successful trading-endpoint access (openOrders, algoOrder, etc.) for demo soft gate. */
export declare function recordBinanceTradingAccessObserved(source: string): void;
export declare function isBinanceInvalidAccountError(error: unknown): boolean;
/**
 * -1109 on balance/account/positionRisk is a known Binance Demo quirk — not proof the wallet is inactive.
 * Trading endpoints (order, openOrders, userTrades) remain authoritative for tradability.
 * listenKey also returns -1109 on demo — rely on reconciliation polling instead of WS.
 */
export declare function isBinanceDemoMetadataUnavailableError(error: unknown): boolean;
/**
 * True when openOrders/getOrder probe failed transiently — do not mark pending rows as
 * reconciliation_failed (demo -1109 on order endpoints after retries, rate limits, etc.).
 */
export declare function isBinanceOrderStateProbeUnavailable(error: unknown): boolean;
/** User-facing message when trading probe fails with -1109. */
export declare function formatBinanceInvalidAccountMessage(): string;
/**
 * Verify the configured key can place orders (order/test probe).
 * Result is cached briefly to avoid hammering Binance during reconciliation loops.
 */
export declare function checkBinanceAccountTradable(force?: boolean): Promise<{
    tradable: boolean;
    reason: string;
}>;
/** True when a recent probe returned non-tradable (used to throttle noisy reconciliation). */
export declare function isBinanceAccountKnownUnhealthy(): boolean;
export declare function clearBinanceAccountHealthCache(): void;
//# sourceMappingURL=binance-account-health.service.d.ts.map