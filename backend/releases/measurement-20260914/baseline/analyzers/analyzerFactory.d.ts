interface MethodConfig {
    methodId: string;
    name: string;
    systemPrompt: string;
}
interface PriceData {
    btc: {
        price: number;
        change24h?: number;
        change7d?: number;
        sparkline7d?: number[];
        prices1h?: number[];
        prices4h?: number[];
        prices1d?: number[];
    };
    eth: {
        price: number;
        change24h?: number;
        change7d?: number;
        sparkline7d?: number[];
        prices1h?: number[];
        prices4h?: number[];
        prices1d?: number[];
    };
    [key: string]: any;
}
interface AnalysisResult {
    btc: any;
    eth: any;
    comparison?: string;
    marketSentiment?: string;
    error?: string;
    raw_question?: string;
    raw_answer?: string;
}
interface Analyzer {
    methodId: string;
    name: string;
    analyze: (priceData: PriceData, db?: any) => Promise<AnalysisResult>;
}
/**
 * Create an analyzer for a specific method
 * @param {Object} methodConfig - Method configuration from METHODS object
 * @returns {Object} Analyzer object with analyze method
 */
export declare function createAnalyzer(methodConfig: MethodConfig): Analyzer;
/**
 * Build user prompt with historical context, open positions, and pending orders
 * @param {Object} priceData - Price data
 * @param {Object} db - Database connection
 * @param {string} methodId - Method ID for filtering
 * @returns {Promise<string>} User prompt string
 */
export declare function buildUserPrompt(priceData: PriceData, db: any, methodId: string): Promise<string>;
export {};
//# sourceMappingURL=analyzerFactory.d.ts.map