/**
 * Market Scan Scheduler
 * Fetches market data and runs signal gate analysis
 * Stores snapshots for later LLM dispatch
 */

import cron, { type ScheduledTask } from 'node-cron';
import { getCandles } from '../services/candle.service';
import { getV3SignalGateTimeframes } from '../config/v3-schedulers';
import { getSignalGateAllowedRegimes, getV3LtfAlignRegimeHtf } from '../config/v3-entry-policy';
import { getSignalGateCandleLimit } from '../config/signal-gate-windows';
import { SignalGateService, type SignalGateOutput } from '../services/signal-gate.service';
import type { UnifiedCandle } from '../services/candle.service';
import type { MarketRegime } from '../analyzers/market-regime.analyzer';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';
import { getEnabledSymbols, getSymbolPolicy } from '../config/symbol-policy';

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
const signalGatesBySymbol = new Map<string, SignalGateService>();

function lastBarOpenTimestamp(candles: UnifiedCandle[]): number | null {
  if (candles.length === 0) return null;
  return candles[candles.length - 1].timestamp;
}

/** HTF first when LTF regime align is enabled (1h before 5m/15m). */
function marketScanTimeframeOrder(timeframes: readonly string[]): string[] {
  const htf = getV3LtfAlignRegimeHtf();
  if (!htf) {
    return [...timeframes];
  }
  const rest = timeframes.filter((t) => t !== htf);
  return [htf, ...rest];
}

/**
 * When the same closed bar is re-scanned, signal gate returns `isDuplicate` and `shouldCallGroq: false`.
 * Overwriting the in-memory snapshot would erase the last fresh PASS — LLMDispatch then skips Groq until the next bar.
 * Keep the prior fresh `signalResult` while still refreshing candles for the same bar open time.
 */
export function mergeDuplicateScanWithPriorEligible(
  prev: MarketScanResult | undefined,
  incoming: MarketScanResult,
  allowKeepPriorEligible = true
): MarketScanResult {
  if (!allowKeepPriorEligible) {
    return incoming;
  }

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

function getSignalGateForSymbol(symbol: string): SignalGateService {
  const normalized = symbol.toUpperCase();
  const existing = signalGatesBySymbol.get(normalized);
  if (existing) return existing;

  const policy = getSymbolPolicy(normalized);
  const gate = new SignalGateService({
    minGrade: policy.minSignalGrade,
    minConfidence: policy.minSignalConfidence,
    allowedRegimes: getSignalGateAllowedRegimes(),
  });
  signalGatesBySymbol.set(normalized, gate);
  return gate;
}

async function scanSymbolTimeframe(
  symbol: string,
  timeframe: string,
  htfRegime: MarketRegime | null
): Promise<void> {
  const limit = getSignalGateCandleLimit(timeframe);
  const { candles, source } = await getCandles({
    symbol,
    timeframe,
    limit,
    cacheToDb: true,
  });

  console.log(
    `[MarketScan] Fetched ${candles.length} candles for ${symbol} ${timeframe} (source: ${source})`
  );

  if (candles.length < 50) {
    console.warn(`[MarketScan] Insufficient candles for ${symbol} ${timeframe}, skipping gate`);
    return;
  }

  const alignHtf = getV3LtfAlignRegimeHtf();
  const signalResult = await getSignalGateForSymbol(symbol).evaluate({
    candles,
    symbol,
    timeframe,
    htfRegime: alignHtf && timeframe !== alignHtf ? htfRegime : undefined,
  });
  const policy = getSymbolPolicy(symbol);
  const playbook = signalResult.setupResult.playbookKey ?? '';
  const policyBlocked =
    signalResult.pass &&
    policy.allowedPlaybooks.length > 0 &&
    !policy.allowedPlaybooks.includes(playbook);
  const effectiveSignalResult: SignalGateOutput = policyBlocked
    ? {
        ...signalResult,
        pass: false,
        shouldCallGroq: false,
        reason:
          `${signalResult.reason} · Symbol policy blocked playbook ${playbook || 'unknown'} ` +
          `(allowed=${policy.allowedPlaybooks.join(',')})`,
      }
    : signalResult;

  const result: MarketScanResult = {
    symbol,
    timeframe,
    candles,
    signalResult: effectiveSignalResult,
    timestamp: new Date(),
  };

  const key = `${symbol}_${timeframe}`;
  const prev = scanResults.get(key);
  const toStore = mergeDuplicateScanWithPriorEligible(prev, result, !policyBlocked);
  scanResults.set(key, toStore);

  const dupTag = signalResult.isDuplicate ? ' (duplicate)' : '';
  if (toStore !== result) {
    console.log(
      `[MarketScan] ${symbol} ${timeframe}: ${effectiveSignalResult.pass ? 'PASS' : 'BLOCK'}${dupTag} — kept prior fresh signal for LLM (same bar)`
    );
  } else {
    console.log(
      `[MarketScan] ${symbol} ${timeframe}: ${effectiveSignalResult.pass ? 'PASS' : 'BLOCK'}${dupTag} - ${effectiveSignalResult.reason}`
    );
  }
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

    const symbols = getEnabledSymbols();
    const timeframes = marketScanTimeframeOrder(getV3SignalGateTimeframes());
    const alignHtf = getV3LtfAlignRegimeHtf();

    for (const symbol of symbols) {
      let htfRegime: MarketRegime | null = null;

      for (const timeframe of timeframes) {
        await scanSymbolTimeframe(symbol, timeframe, htfRegime);
        if (alignHtf && timeframe === alignHtf) {
          const snap = getScanResult(symbol, timeframe);
          htfRegime = snap?.signalResult.setupResult.regime ?? null;
        }
      }
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
