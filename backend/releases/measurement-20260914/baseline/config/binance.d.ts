/**
 * Binance Futures Configuration
 *
 * This module exports configuration for Binance Futures integration
 * Supports both Demo Trading (demo-fapi.binance.com) and Mainnet (fapi.binance.com)
 */
export interface BinanceConfig {
    apiKey: string;
    secretKey: string;
    enabled: boolean;
    symbol: string;
    leverage: number;
    rateLimits: {
        requestWeight: number;
        orderRate: number;
        rawRequests: number;
    };
    orderTypes: {
        MARKET: string;
        LIMIT: string;
        STOP_MARKET: string;
        STOP_LIMIT: string;
        TAKE_PROFIT_MARKET: string;
        TAKE_PROFIT_LIMIT: string;
    };
    sides: {
        BUY: string;
        SELL: string;
    };
    positionSides: {
        BOTH: string;
        LONG: string;
        SHORT: string;
    };
    timeInForce: {
        GTC: string;
        IOC: string;
        FOK: string;
        GTX: string;
    };
    workingHours: {
        london: {
            start: number;
            end: number;
        };
        nyKillzone: {
            start: number;
            end: number;
        };
    };
}
export declare const binanceConfig: BinanceConfig;
/**
 * Validate API keys on startup
 */
export declare function validateConfig(): boolean;
/**
 * Get leverage for trading
 */
export declare function getLeverage(): number;
/**
 * Get trading symbol
 */
export declare function getSymbol(): string;
//# sourceMappingURL=binance.d.ts.map