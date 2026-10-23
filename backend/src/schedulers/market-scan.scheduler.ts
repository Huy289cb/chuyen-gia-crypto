/**
 * Market Scan Scheduler
 * Fetches market data and runs signal gate analysis
 * Stores snapshots for later LLM dispatch
 */

import cron, { type ScheduledTask } from 'node-cron';
import { getCandles } from '../services/candle.service';
import { getV3SignalGateTimeframes } from '../config/v3-schedulers';
import { getV3LtfAlignRegimeHtf } from '../config/v3-entry-policy';
import { getSignalGateCandleLimit } from '../config/signal-gate-windows';
import { signalGateService, type SignalGateOutput } from '../services/signal-gate.service';
import type { UnifiedCandle } from '../services/candle.service';
import type { MarketRegime } from '../analyzers/market-regime.analyzer';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';
import { closedCandlesOnly } from '../utils/closed-candles';
import { recordEntryGateFunnel } from '../services/entry-gate-funnel.service';
import {
  processTransitionRetestScan,
  registerTransitionRetestCandidate,
} from '../services/transition-breakout-retest.service';
import {
  isIctShadowFunnelEnabled,
  recordIctShadowFunnel,
} from '../services/ict-shadow-funnel.service';
import { inferSetupTradeSide } from '../utils/setup-trade-side';
import fs from 'fs';
import path from 'path';

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

async function scanSymbolTimeframe(
  symbol: string,
  timeframe: string,
  htfRegime: MarketRegime | null
): Promise<MarketScanResult | null> {
  const limit = getSignalGateCandleLimit(timeframe);
  const { candles: fetchedCandles, source } = await getCandles({
    symbol,
    timeframe,
    limit,
    cacheToDb: true,
  });
  // Unified/Binance timestamps are bar-open times. The current in-progress bar
  // must not influence signal or HTF state; include it only after open+TF <= now.
  const candles = closedCandlesOnly(fetchedCandles, timeframe);

  console.log(
    `[MarketScan] Fetched ${fetchedCandles.length} candles (${candles.length} closed) ` +
      `for ${symbol} ${timeframe} (source: ${source})`
  );

  if (candles.length < 50) {
    console.warn(`[MarketScan] Insufficient candles for ${symbol} ${timeframe}, skipping gate`);
    return null;
  }

  const alignHtf = getV3LtfAlignRegimeHtf();
  const signalResult = await signalGateService.evaluate({
    candles,
    symbol,
    timeframe,
    htfRegime: alignHtf && timeframe !== alignHtf ? htfRegime : undefined,
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
  return result;
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

    const symbols = ['BTC'];
    const timeframes = marketScanTimeframeOrder(getV3SignalGateTimeframes());
    const alignHtf = getV3LtfAlignRegimeHtf();

    for (const symbol of symbols) {
      let htfRegime: MarketRegime | null = null;
      const freshScans: MarketScanResult[] = [];

      for (const timeframe of timeframes) {
        const fresh = await scanSymbolTimeframe(symbol, timeframe, htfRegime);
        if (fresh && !fresh.signalResult.isDuplicate) {
          freshScans.push(fresh);
        }
        if (alignHtf && timeframe === alignHtf) {
          const snap = getScanResult(symbol, timeframe);
          htfRegime = snap?.signalResult.setupResult.regime ?? null;
        }
      }

      for (const candidate of freshScans) {
        try {
          const observation = await recordEntryGateFunnel({
            symbol,
            timeframe: candidate.timeframe,
            candles: candidate.candles,
            signalResult: candidate.signalResult,
            getScan: (tf) => getScanResult(symbol, tf),
          });
          if (observation) {
            console.log(
              `[GateFunnel] ${symbol} ${candidate.timeframe} ${observation.grade}/${observation.playbook} ` +
                `first=${observation.first_block ?? 'pass'} all=${observation.all_blocks.join(',') || 'none'}`
            );
            await registerTransitionRetestCandidate(
              observation,
              candidate.candles,
              candidate.signalResult,
              Date.now(),
              (tf) => getScanResult(symbol, tf)
            );
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[GateFunnel] ${symbol} ${candidate.timeframe} observation failed: ${msg}`);
        }
      }

      // P1c: ICT shadow funnel (default OFF). No orders; overlap vs LS/BO only.
      if (isIctShadowFunnelEnabled()) {
        try {
          await emitIctShadowFromLatestCollection(symbol, freshScans);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[IctShadowFunnel] ${symbol} failed: ${msg}`);
        }
      }

      for (const scan of freshScans) {
        try {
          await processTransitionRetestScan({
            symbol,
            timeframe: scan.timeframe,
            candles: scan.candles,
            getScan: (tf) => getScanResult(symbol, tf),
          });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[TransitionRetest] ${symbol} ${scan.timeframe} scan failed: ${msg}`);
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
export function startMarketScanScheduler(cronExpression: string = '5 */5 * * * *') {
  if (marketScanTask) {
    console.warn('[MarketScan] Scheduler already running');
    return;
  }

  console.log(`[MarketScan] Starting scheduler with cron: ${cronExpression}`);
  // Event-loop delays must not silently skip the five-second candle-close boundary.
  // runMarketScan reads current closed candles and its in-flight guard coalesces catch-up ticks.
  let lastScheduledSecond = -1;
  marketScanTask = cron.schedule(cronExpression, (scheduledAt) => {
    // node-cron 3 can emit the same second again when recovery retains subsecond drift.
    const second = Math.floor((scheduledAt instanceof Date ? scheduledAt.getTime() : Date.now()) / 1000);
    if (second <= lastScheduledSecond) return;
    lastScheduledSecond = second;
    void runMarketScan();
  }, { recoverMissedExecutions: true });

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
 * Shadow-only: read latest frozen ICT prospective detector JSON (if present) and
 * emit funnel observations with LS/BO overlap tags. Never places orders.
 */
async function emitIctShadowFromLatestCollection(
  symbol: string,
  freshScans: MarketScanResult[]
): Promise<void> {
  const collectionDir = path.resolve(
    __dirname,
    '../../../docs/audits/2026-09-15-ict-opportunities/prospective-collection'
  );
  // ponytail: read newest *-detector.json only; upgrade = live detector spawn when sample path matures
  if (!fs.existsSync(collectionDir)) return;
  const detectors = fs
    .readdirSync(collectionDir)
    .filter((f) => f.endsWith('-detector.json'))
    .sort()
    .reverse();
  if (!detectors.length) return;
  const raw = JSON.parse(fs.readFileSync(path.join(collectionDir, detectors[0]), 'utf8')) as {
    candidates?: Array<{
      id: string;
      side: 'long' | 'short';
      entry: number;
      stopLoss: number;
      target?: { price: number } | null;
      rr?: number | null;
      confirmedAt?: number;
    }>;
  };
  const kim = freshScans.map((scan) => ({
    playbook: scan.signalResult.setupResult.playbookKey ?? 'unknown',
    side: inferSetupTradeSide(scan.signalResult.setupResult, scan.timeframe, scan.candles),
  }));
  for (const c of raw.candidates ?? []) {
    const obs = await recordIctShadowFunnel({
      symbol,
      plan: {
        id: c.id,
        side: c.side,
        entry: c.entry,
        stopLoss: c.stopLoss,
        targetPrice: c.target?.price ?? null,
        rr: c.rr ?? null,
        confirmedAt: c.confirmedAt,
        source: detectors[0],
      },
      kimNghiaPlaybooks: kim,
    });
    if (obs) {
      console.log(
        `[IctShadowFunnel] ${obs.plan_id} side=${obs.side} ` +
          `overlap=${obs.overlap_kim_nghia.join(',') || 'none'} ` +
          `incremental=${obs.incremental_vs_ls_bo} conflict=${obs.conflict_with_kim_nghia}`
      );
    }
  }
}

/**
 * Run market scan manually (for testing)
 */
export async function runManualMarketScan() {
  return await runMarketScan();
}
