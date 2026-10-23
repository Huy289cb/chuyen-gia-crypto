/**
 * Mainnet safety gates.
 *
 * Mainnet can be used in read-only/shadow mode by pointing BINANCE_BASE_URL at
 * fapi.binance.com. Any trading mutation remains blocked until the explicit
 * live-trading acknowledgement is present.
 */
export declare function getBinanceBaseUrl(): string;
export declare function isBinanceMainnet(): boolean;
export declare function isMainnetLiveTradingEnabled(): boolean;
export declare function getMainnetMaxExposureUsd(): number;
export declare function getMainnetMaxLeverage(): number;
export declare function getMainnetMaxRiskPercent(): number;
export declare function getEffectiveMaxExposureUsd(configured: number): number;
export declare function getEffectiveRiskPerTradePercent(configured: number): number;
export declare function isBinanceTradingMutation(method: string, path: string): boolean;
export declare function assertBinanceMutationAllowed(method: string, path: string): void;
export declare function validateMainnetSafetyRequirements(): string[];
//# sourceMappingURL=mainnet-safety.d.ts.map