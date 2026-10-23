"use strict";
/**
 * Market Scan Scheduler
 * Fetches market data and runs signal gate analysis
 * Stores snapshots for later LLM dispatch
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScanResult = getScanResult;
exports.startMarketScanScheduler = startMarketScanScheduler;
exports.stopMarketScanScheduler = stopMarketScanScheduler;
exports.runManualMarketScan = runManualMarketScan;
const node_cron_1 = __importDefault(require("node-cron"));
const candle_service_1 = require("../services/candle.service");
const v3_schedulers_1 = require("../config/v3-schedulers");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const signal_gate_windows_1 = require("../config/signal-gate-windows");
const signal_gate_service_1 = require("../services/signal-gate.service");
const scheduler_heartbeat_1 = require("../utils/scheduler-heartbeat");
const closed_candles_1 = require("../utils/closed-candles");
const entry_gate_funnel_service_1 = require("../services/entry-gate-funnel.service");
const transition_breakout_retest_service_1 = require("../services/transition-breakout-retest.service");
let marketScanTask = null;
let isRunning = false;
const scanResults = new Map();
function lastBarOpenTimestamp(candles) {
    if (candles.length === 0)
        return null;
    return candles[candles.length - 1].timestamp;
}
/** HTF first when LTF regime align is enabled (1h before 5m/15m). */
function marketScanTimeframeOrder(timeframes) {
    const htf = (0, v3_entry_policy_1.getV3LtfAlignRegimeHtf)();
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
function mergeDuplicateScanWithPriorEligible(prev, incoming) {
    const prevBar = lastBarOpenTimestamp(prev?.candles ?? []);
    const nextBar = lastBarOpenTimestamp(incoming.candles);
    const p = prev?.signalResult;
    if (prev &&
        p &&
        prevBar != null &&
        nextBar != null &&
        prevBar === nextBar &&
        !p.isDuplicate &&
        p.pass &&
        p.shouldCallGroq &&
        incoming.signalResult.isDuplicate) {
        return {
            ...incoming,
            signalResult: p,
            timestamp: new Date(),
        };
    }
    return incoming;
}
async function scanSymbolTimeframe(symbol, timeframe, htfRegime) {
    const limit = (0, signal_gate_windows_1.getSignalGateCandleLimit)(timeframe);
    const { candles: fetchedCandles, source } = await (0, candle_service_1.getCandles)({
        symbol,
        timeframe,
        limit,
        cacheToDb: true,
    });
    // Unified/Binance timestamps are bar-open times. The current in-progress bar
    // must not influence signal or HTF state; include it only after open+TF <= now.
    const candles = (0, closed_candles_1.closedCandlesOnly)(fetchedCandles, timeframe);
    console.log(`[MarketScan] Fetched ${fetchedCandles.length} candles (${candles.length} closed) ` +
        `for ${symbol} ${timeframe} (source: ${source})`);
    if (candles.length < 50) {
        console.warn(`[MarketScan] Insufficient candles for ${symbol} ${timeframe}, skipping gate`);
        return null;
    }
    const alignHtf = (0, v3_entry_policy_1.getV3LtfAlignRegimeHtf)();
    const signalResult = await signal_gate_service_1.signalGateService.evaluate({
        candles,
        symbol,
        timeframe,
        htfRegime: alignHtf && timeframe !== alignHtf ? htfRegime : undefined,
    });
    const result = {
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
        console.log(`[MarketScan] ${symbol} ${timeframe}: ${signalResult.pass ? 'PASS' : 'BLOCK'}${dupTag} — kept prior fresh signal for LLM (same bar)`);
    }
    else {
        console.log(`[MarketScan] ${symbol} ${timeframe}: ${signalResult.pass ? 'PASS' : 'BLOCK'}${dupTag} - ${signalResult.reason}`);
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
    (0, scheduler_heartbeat_1.recordSchedulerRun)('MarketScan');
    try {
        console.log('[MarketScan] Starting market scan');
        const symbols = ['BTC'];
        const timeframes = marketScanTimeframeOrder((0, v3_schedulers_1.getV3SignalGateTimeframes)());
        const alignHtf = (0, v3_entry_policy_1.getV3LtfAlignRegimeHtf)();
        for (const symbol of symbols) {
            let htfRegime = null;
            const freshScans = [];
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
                    const observation = await (0, entry_gate_funnel_service_1.recordEntryGateFunnel)({
                        symbol,
                        timeframe: candidate.timeframe,
                        candles: candidate.candles,
                        signalResult: candidate.signalResult,
                        getScan: (tf) => getScanResult(symbol, tf),
                    });
                    if (observation) {
                        console.log(`[GateFunnel] ${symbol} ${candidate.timeframe} ${observation.grade}/${observation.playbook} ` +
                            `first=${observation.first_block ?? 'pass'} all=${observation.all_blocks.join(',') || 'none'}`);
                        await (0, transition_breakout_retest_service_1.registerTransitionRetestCandidate)(observation, candidate.candles, candidate.signalResult, Date.now(), (tf) => getScanResult(symbol, tf));
                    }
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.warn(`[GateFunnel] ${symbol} ${candidate.timeframe} observation failed: ${msg}`);
                }
            }
            for (const scan of freshScans) {
                try {
                    await (0, transition_breakout_retest_service_1.processTransitionRetestScan)({
                        symbol,
                        timeframe: scan.timeframe,
                        candles: scan.candles,
                        getScan: (tf) => getScanResult(symbol, tf),
                    });
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.warn(`[TransitionRetest] ${symbol} ${scan.timeframe} scan failed: ${msg}`);
                }
            }
        }
        console.log('[MarketScan] Market scan completed');
    }
    catch (error) {
        console.error('[MarketScan] Error during market scan:', error);
    }
    finally {
        isRunning = false;
    }
}
/**
 * Get latest scan result for a symbol and timeframe
 */
function getScanResult(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    return scanResults.get(key);
}
/**
 * Start market scan scheduler
 */
function startMarketScanScheduler(cronExpression = '5 */5 * * * *') {
    if (marketScanTask) {
        console.warn('[MarketScan] Scheduler already running');
        return;
    }
    console.log(`[MarketScan] Starting scheduler with cron: ${cronExpression}`);
    // Event-loop delays must not silently skip the five-second candle-close boundary.
    // runMarketScan reads current closed candles and its in-flight guard coalesces catch-up ticks.
    let lastScheduledSecond = -1;
    marketScanTask = node_cron_1.default.schedule(cronExpression, (scheduledAt) => {
        // node-cron 3 can emit the same second again when recovery retains subsecond drift.
        const second = Math.floor((scheduledAt instanceof Date ? scheduledAt.getTime() : Date.now()) / 1000);
        if (second <= lastScheduledSecond)
            return;
        lastScheduledSecond = second;
        void runMarketScan();
    }, { recoverMissedExecutions: true });
    runMarketScan();
}
/**
 * Stop market scan scheduler
 */
function stopMarketScanScheduler() {
    if (marketScanTask) {
        marketScanTask.stop();
        marketScanTask = null;
        console.log('[MarketScan] Scheduler stopped');
    }
}
/**
 * Run market scan manually (for testing)
 */
async function runManualMarketScan() {
    return await runMarketScan();
}
//# sourceMappingURL=market-scan.scheduler.js.map