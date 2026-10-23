/**
 * Market Scan Scheduler
 * Fetches market data and runs signal gate analysis
 * Stores snapshots for later LLM dispatch
 */
import { type SignalGateOutput } from '../services/signal-gate.service';
import type { UnifiedCandle } from '../services/candle.service';
export interface MarketScanResult {
    symbol: string;
    timeframe: string;
    candles: UnifiedCandle[];
    signalResult: SignalGateOutput;
    timestamp: Date;
}
/**
 * Get latest scan result for a symbol and timeframe
 */
export declare function getScanResult(symbol: string, timeframe: string): MarketScanResult | undefined;
/**
 * Start market scan scheduler
 */
export declare function startMarketScanScheduler(cronExpression?: string): void;
/**
 * Stop market scan scheduler
 */
export declare function stopMarketScanScheduler(): void;
/**
 * Run market scan manually (for testing)
 */
export declare function runManualMarketScan(): Promise<void>;
//# sourceMappingURL=market-scan.scheduler.d.ts.map