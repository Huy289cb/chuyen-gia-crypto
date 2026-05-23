/**
 * Market Scan Scheduler
 * Fetches market data and runs signal gate analysis
 * Stores snapshots for later LLM dispatch
 */

import cron, { type ScheduledTask } from 'node-cron';
import { getCandles } from '../services/candle.service';
import { getV3SignalGateTimeframes } from '../config/v3-schedulers';
import { signalGateService, type SignalGateOutput } from '../services/signal-gate.service';
import type { UnifiedCandle } from '../services/candle.service';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';

let marketScanTask: ScheduledTask | null = null;
let isRunning = false;

export interface MarketScanResult {
  symbol: string;
  timeframe: string;
  candles: UnifiedCandle[];
  signalResult: SignalGateOutput;
  timestamp: Date;
}

const scanResults = new Map<string, MarketScanResult>();

function lastBarOpenTimestamp(candles: UnifiedCandle[]): number | null {
  if (candles.length === 0) return null;
  return candles[candles.length - 1].timestamp;
}

/**
 * When the same closed bar is re-scanned, signal gate returns `isDuplicate` and `shouldCallGroq: false`.
 * Overwriting the in-memory snapshot would erase the last fresh PASS — LLMDispatch then skips Groq until the next bar.
 * Keep the prior fresh `signalResult` while still refreshing candles for the same bar open time.
 */
function mergeDuplicateScanWithPriorEligible(
  prev: MarketScanResult | undefined,
  incoming: MarketScanResult
): MarketScanResult {
  const prevBar = lastBarOpenTimestamp(prev?.candles ?? []);
  const nextBar = lastBarOpenTimestamp(incoming.candles);
  const p = prev?.signalResult;
  if (
    prev &&
    p &&
    prevBar != null &&
    nextBar != null &&
    prevBar === nextBar &&
    !p.isDuplicate &&
    p.pass &&
    p.shouldCallGroq &&
    incoming.signalResult.isDuplicate
  ) {
    return {
      ...incoming,
      signalResult: p,
      timestamp: new Date(),
    };
  }
  return incoming;
}

/**
 * Run market scan for configured symbols
 */
async function runMarketScan() {
  if (isRunning) {
    console.warn('[MarketScan] Previous scan still running, skipping cycle');
    return;
  }

  isRunning = true;
  recordSchedulerRun('MarketScan');
  try {
    console.log('[MarketScan] Starting market scan');

    const symbols = ['BTC']; // BTC-only per Big Update Plan v3
    const timeframes = [...getV3SignalGateTimeframes()];

    for (const symbol of symbols) {
      await Promise.all(
        timeframes.map(async (timeframe) => {
          const { candles, source } = await getCandles({
            symbol,
            timeframe,
            limit: 100,
            cacheToDb: true,
          });

          console.log(
            `[MarketScan] Fetched ${candles.length} candles for ${symbol} ${timeframe} (source: ${source})`
          );

          if (candles.length < 50) {
            console.warn(`[MarketScan] Insufficient candles for ${symbol} ${timeframe}, skipping gate`);
            return;
          }

          const signalResult = await signalGateService.evaluate({
            candles,
            symbol,
            timeframe,
          });

          const result: MarketScanResult = {
            symbol,
            timeframe,
            candles,
            signalResult,
            timestamp: new Date(),
          };

          const key = `${symbol}_${timeframe}`;
          const prev = scanResults.get(key);
          const toStore = mergeDuplicateScanWithPriorEligible(prev, result);
          scanResults.set(key, toStore);

          const dupTag = signalResult.isDuplicate ? ' (duplicate)' : '';
          if (toStore !== result) {
            console.log(
              `[MarketScan] ${symbol} ${timeframe}: ${signalResult.pass ? 'PASS' : 'BLOCK'}${dupTag} — kept prior fresh signal for LLM (same bar)`
            );
          } else {
            console.log(
              `[MarketScan] ${symbol} ${timeframe}: ${signalResult.pass ? 'PASS' : 'BLOCK'}${dupTag} - ${signalResult.reason}`
            );
          }
        })
      );
    }

    console.log('[MarketScan] Market scan completed');
  } catch (error) {
    console.error('[MarketScan] Error during market scan:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Get latest scan result for a symbol and timeframe
 */
export function getScanResult(symbol: string, timeframe: string): MarketScanResult | undefined {
  const key = `${symbol}_${timeframe}`;
  return scanResults.get(key);
}

/**
 * Start market scan scheduler
 */
export function startMarketScanScheduler(cronExpression: string = '*/5 * * * *') {
  if (marketScanTask) {
    console.warn('[MarketScan] Scheduler already running');
    return;
  }

  console.log(`[MarketScan] Starting scheduler with cron: ${cronExpression}`);
  marketScanTask = cron.schedule(cronExpression, runMarketScan);
  
  // Run immediately on start
  runMarketScan();
}

/**
 * Stop market scan scheduler
 */
export function stopMarketScanScheduler() {
  if (marketScanTask) {
    marketScanTask.stop();
    marketScanTask = null;
    console.log('[MarketScan] Scheduler stopped');
  }
}

/**
 * Run market scan manually (for testing)
 */
export async function runManualMarketScan() {
  return await runMarketScan();
}
