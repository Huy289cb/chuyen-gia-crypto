/**
 * Binance Futures Configuration
 *
 * Configuration for Binance Futures API (Demo + Mainnet)
 */
export declare const config: {
    BASE_URL: string;
    API_KEY: string;
    API_SECRET: string;
    RECV_WINDOW: number;
    SYMBOL: string;
    LEVERAGE: number;
    RATE_LIMITS: {
        REQUEST_WEIGHT: number;
        ORDER_RATE: number;
        RAW_REQUESTS: number;
    };
    ORDER_TYPES: {
        MARKET: string;
        LIMIT: string;
        STOP_MARKET: string;
        STOP_LIMIT: string;
        TAKE_PROFIT_MARKET: string;
        TAKE_PROFIT_LIMIT: string;
    };
    SIDES: {
        BUY: string;
        SELL: string;
    };
    TIME_IN_FORCE: {
        GTC: string;
        IOC: string;
        FOK: string;
        GTX: string;
    };
    MARGIN_TYPES: {
        ISOLATED: string;
        CROSSED: string;
    };
};
/**
 * Validate configuration
 * @returns {boolean} True if valid
 */
export declare function validateConfig(): boolean;
//# sourceMappingURL=config.d.ts.map