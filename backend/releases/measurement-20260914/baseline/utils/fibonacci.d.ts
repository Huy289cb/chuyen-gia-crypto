interface OHLCData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}
interface SwingPoints {
    swingHigh: number | null;
    swingLow: number | null;
    swingHighTime: number | null;
    swingLowTime: number | null;
}
interface FibonacciLevel {
    level: number;
    price: number;
    label: string;
}
interface FibonacciResult {
    retracement: FibonacciLevel[];
    extension: FibonacciLevel[];
}
interface FibonacciResultWithSwing extends FibonacciResult {
    swingHigh: number | null;
    swingLow: number | null;
}
/**
 * Detect swing high/low from OHLC data
 * @param {Array} ohlcData - Array of OHLC candles {time, open, high, low, close}
 * @param {number} lookback - Number of candles to look back for swing detection (default: 20)
 * @returns {Object} { swingHigh, swingLow, swingHighTime, swingLowTime }
 */
export declare function detectSwingPoints(ohlcData: OHLCData[], lookback?: number): SwingPoints;
/**
 * Calculate Fibonacci retracement and extension levels
 * @param {number} swingHigh - Swing high price
 * @param {number} swingLow - Swing low price
 * @param {string} direction - 'up' (bullish) or 'down' (bearish)
 * @returns {Object} { retracement: [], extension: [] }
 */
export declare function calculateFibonacciLevels(swingHigh: number, swingLow: number, direction?: string): FibonacciResult;
/**
 * Get Fibonacci levels from OHLC data
 * @param {Array} ohlcData - Array of OHLC candles
 * @param {string} direction - 'up' (bullish) or 'down' (bearish)
 * @param {number} lookback - Lookback period for swing detection
 * @returns {Object} { retracement: [], extension: [], swingHigh, swingLow }
 */
export declare function getFibonacciFromOHLC(ohlcData: OHLCData[], direction?: string, lookback?: number): FibonacciResultWithSwing;
export {};
//# sourceMappingURL=fibonacci.d.ts.map