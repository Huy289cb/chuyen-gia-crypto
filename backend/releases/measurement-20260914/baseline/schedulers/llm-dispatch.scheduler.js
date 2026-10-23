"use strict";
/**
 * LLM Dispatch Scheduler
 * Processes valid signals from market scan and dispatches to Groq
 * Only processes signals that passed the signal gate
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startLLMDispatchScheduler = startLLMDispatchScheduler;
exports.stopLLMDispatchScheduler = stopLLMDispatchScheduler;
exports.runManualLLMDispatch = runManualLLMDispatch;
const node_cron_1 = __importDefault(require("node-cron"));
const v3_schedulers_1 = require("../config/v3-schedulers");
const v3_schedulers_2 = require("../config/v3-schedulers");
const groq_dispatch_service_1 = require("../services/groq-dispatch.service");
const market_scan_scheduler_1 = require("./market-scan.scheduler");
const methods_1 = require("../config/methods");
const v3_trade_execution_service_1 = require("../services/v3-trade-execution.service");
const memory_service_1 = require("../services/memory.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const trade_levels_1 = require("../utils/trade-levels");
const signal_gate_ranking_1 = require("../utils/signal-gate-ranking");
const scheduler_heartbeat_1 = require("../utils/scheduler-heartbeat");
const pending_order_lifecycle_service_1 = require("../services/pending-order-lifecycle.service");
const pending_order_review_service_1 = require("../services/pending-order-review.service");
const v3_entry_eligibility_service_1 = require("../services/v3-entry-eligibility.service");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const transition_breakout_retest_service_1 = require("../services/transition-breakout-retest.service");
let llmDispatchTask = null;
let isRunning = false;
function getV3Timeframes() {
    return (0, v3_schedulers_2.getV3SignalGateTimeframes)();
}
function pickBestScanResult(symbol) {
    const candidates = [];
    for (const timeframe of getV3Timeframes()) {
        const scanResult = (0, market_scan_scheduler_1.getScanResult)(symbol, timeframe);
        if (!scanResult)
            continue;
        const { signalResult } = scanResult;
        if (signalResult.isDuplicate) {
            console.log(`[LLMDispatch] ${symbol} ${timeframe}: Duplicate candle state, skipping`);
            continue;
        }
        if (!signalResult.pass) {
            console.log(`[LLMDispatch] ${symbol} ${timeframe}: Signal gate blocked, skipping`);
            continue;
        }
        if (!signalResult.shouldCallGroq) {
            console.log(`[LLMDispatch] ${symbol} ${timeframe}: Signal gate skip (no Groq), skipping`);
            continue;
        }
        candidates.push({ timeframe, scanResult });
    }
    if (candidates.length === 0)
        return null;
    const sorted = [...candidates].sort((a, b) => (0, signal_gate_ranking_1.compareSignalGateForEntry)({ timeframe: a.timeframe, result: a.scanResult.signalResult }, { timeframe: b.timeframe, result: b.scanResult.signalResult }));
    const best = sorted[0];
    if (candidates.length > 1) {
        console.log(`[LLMDispatch] ${symbol}: best of [${candidates.map((c) => c.timeframe).join(', ')}] → ${best.timeframe}`);
    }
    return best;
}
/**
 * Run LLM dispatch for valid signals
 */
async function runLLMDispatch() {
    if (isRunning) {
        console.warn('[LLMDispatch] Previous dispatch still running, skipping cycle');
        return;
    }
    isRunning = true;
    (0, scheduler_heartbeat_1.recordSchedulerRun)('LLMDispatch');
    try {
        console.log('[LLMDispatch] Starting LLM dispatch');
        const symbols = ['BTC'];
        for (const symbol of symbols) {
            const [openPositions, blockingPending] = await Promise.all([
                (0, testnet_repository_1.getTestnetPositions)({ symbol, status: 'open' }),
                (0, testnet_repository_1.getBlockingTestnetPendingOrders)({ symbol }),
            ]);
            const pendingForLifecycle = blockingPending.filter((o) => o.status === 'pending');
            let cancelledThisCycle = 0;
            if (pendingForLifecycle.length > 0) {
                const lifecycle = await (0, pending_order_lifecycle_service_1.runPendingOrderLifecycle)(symbol);
                cancelledThisCycle += lifecycle.cancelled;
                if (lifecycle.cancelled > 0) {
                    console.log(`[LLMDispatch] ${symbol}: pending lifecycle cancelled ${lifecycle.cancelled} order(s)`);
                }
                const review = await (0, pending_order_review_service_1.runPendingOrderReview)(symbol);
                cancelledThisCycle += review.cancelled;
                if (review.cancelled > 0 || review.modified > 0) {
                    console.log(`[LLMDispatch] ${symbol}: pending LLM review cancelled=${review.cancelled} modified=${review.modified}`);
                }
            }
            // Never place a fresh limit in the same cycle we just cancelled — kills place/cancel spam.
            if (cancelledThisCycle > 0) {
                console.log(`[LLMDispatch] ${symbol}: skip new trade — cancelled ${cancelledThisCycle} pending this cycle`);
                continue;
            }
            const eligibility = await (0, v3_entry_eligibility_service_1.canRunLlmDispatchForSymbol)(symbol);
            if (!eligibility.allowed) {
                console.log(`[LLMDispatch] ${symbol}: skip new trade — ${eligibility.reason}`);
                continue;
            }
            if (openPositions.length > 0 && (0, v3_entry_policy_1.isV3ScaleInEnabled)()) {
                console.log(`[LLMDispatch] ${symbol}: scale-in allowed — ${eligibility.reason} open=${openPositions.length}`);
            }
            let retestOpportunity = null;
            let timeframe;
            let scanResult;
            const readyRetest = (0, transition_breakout_retest_service_1.peekTransitionRetestOpportunity)(symbol);
            const readyScan = readyRetest
                ? (0, market_scan_scheduler_1.getScanResult)(symbol, readyRetest.timeframe)
                : undefined;
            if (readyRetest && readyScan) {
                const claimed = await (0, transition_breakout_retest_service_1.claimTransitionRetestOpportunity)(readyRetest.candidate_key);
                if (!claimed)
                    continue;
                retestOpportunity = claimed;
                timeframe = claimed.timeframe;
                scanResult = {
                    ...readyScan,
                    signalResult: {
                        ...claimed.signal_result,
                        pass: true,
                        shouldCallGroq: true,
                        isDuplicate: false,
                        reason: `Stateful ${claimed.candidate_kind} retest confirmed (${claimed.candidate_key})`,
                    },
                };
                console.log(`[LLMDispatch] ${symbol} ${timeframe}: prioritizing ${claimed.mode} ` +
                    `${claimed.candidate_kind} retest ${claimed.candidate_key}`);
            }
            else {
                const picked = pickBestScanResult(symbol);
                if (!picked)
                    continue;
                timeframe = picked.timeframe;
                scanResult = picked.scanResult;
            }
            const methodConfig = (0, methods_1.getMethodConfig)('kim_nghia');
            const dispatchResult = await groq_dispatch_service_1.groqDispatchService.dispatch({
                symbol,
                timeframe,
                candles: scanResult.candles,
                systemPrompt: methodConfig.systemPrompt,
                method_id: 'kim_nghia',
                signalResult: scanResult.signalResult,
                retestContext: retestOpportunity
                    ? {
                        candidateKey: retestOpportunity.candidate_key,
                        candidateKind: retestOpportunity.candidate_kind,
                        side: retestOpportunity.side,
                        boundaryPrice: retestOpportunity.boundary_price,
                        breakoutBarKey: retestOpportunity.breakout_bar_key,
                        confirmedEntryPrice: retestOpportunity.entry_price,
                        minRr: retestOpportunity.rr,
                        rangeLow: Number(retestOpportunity.adaptive_evidence?.range_low),
                        rangeHigh: Number(retestOpportunity.adaptive_evidence?.range_high),
                    }
                    : undefined,
            });
            console.log(`[LLMDispatch] ${symbol} ${timeframe}: ${dispatchResult.decision.toUpperCase()} - ${dispatchResult.reason}`);
            if (dispatchResult.decision === 'no_trade') {
                const isRiskPreBlock = dispatchResult.reason.includes('Risk engine blocked') ||
                    dispatchResult.reason.includes('SL distance');
                if (isRiskPreBlock && dispatchResult.analysis) {
                    await (0, testnet_repository_1.recordPipelineEvent)('execution_blocked', {
                        symbol,
                        timeframe,
                        reason: dispatchResult.reason,
                        phase: 'pre_execution',
                        action: dispatchResult.analysis.action,
                        entry: dispatchResult.analysis.suggested_entry,
                        stop_loss: dispatchResult.analysis.suggested_stop_loss,
                        take_profit: dispatchResult.analysis.suggested_take_profit,
                        decision_id: dispatchResult.decisionRecordId,
                    });
                }
                if (retestOpportunity) {
                    await (0, transition_breakout_retest_service_1.recordTransitionRetestDispatch)({
                        opportunity: retestOpportunity,
                        decision: 'no_trade',
                        reason: dispatchResult.reason,
                        executionAttempted: false,
                        decisionRecordId: dispatchResult.decisionRecordId,
                    });
                }
            }
            if (dispatchResult.decision === 'trade' && dispatchResult.analysis) {
                console.log(`[LLMDispatch] Trade signal received for ${symbol} ${timeframe}`);
                console.log(`[LLMDispatch] Action: ${dispatchResult.analysis.action}, Bias: ${dispatchResult.analysis.bias}, ` +
                    `Confidence: ${((dispatchResult.analysis.confidence ?? 0) * 100).toFixed(0)}%`);
                if (retestOpportunity && retestOpportunity.mode !== 'live') {
                    console.log(`[LLMDispatch] ${symbol} ${timeframe}: retest LLM confirmed in ${retestOpportunity.mode}; ` +
                        `execution intentionally skipped`);
                    await (0, transition_breakout_retest_service_1.recordTransitionRetestDispatch)({
                        opportunity: retestOpportunity,
                        decision: 'trade',
                        reason: dispatchResult.reason,
                        executionAttempted: false,
                        executionReason: `${retestOpportunity.mode} does not execute`,
                        decisionRecordId: dispatchResult.decisionRecordId,
                    });
                    continue;
                }
                const execResult = await (0, v3_trade_execution_service_1.executeV3Trade)({
                    symbol,
                    timeframe,
                    analysis: dispatchResult.analysis,
                    methodId: 'kim_nghia',
                    decisionRecordId: dispatchResult.decisionRecordId,
                    requiredMinRr: retestOpportunity?.rr ?? methodConfig.autoEntry.minRRRatio,
                });
                if (execResult.success) {
                    console.log(`[LLMDispatch] Binance pending order ${execResult.orderId} ` +
                        `(binance=${execResult.binanceOrderId}) for ${symbol}` +
                        (execResult.levelAdjustment
                            ? `; normalized stop ${execResult.levelAdjustment.originalStopPercent.toFixed(2)}%` +
                                `→${execResult.levelAdjustment.normalizedStopPercent.toFixed(2)}%`
                            : ''));
                }
                else {
                    console.warn(`[LLMDispatch] Trade execution skipped: ${execResult.reason}`);
                    const summary = (0, trade_levels_1.formatLlmTradeSummary)(dispatchResult.analysis);
                    if (dispatchResult.decisionRecordId) {
                        await memory_service_1.memoryService.recordExecutionBlocked(dispatchResult.decisionRecordId, symbol, summary, execResult.reason);
                    }
                    await (0, testnet_repository_1.recordPipelineEvent)('execution_blocked', {
                        symbol,
                        timeframe,
                        reason: execResult.reason,
                        phase: 'binance_execution',
                        action: dispatchResult.analysis.action,
                        entry: dispatchResult.analysis.suggested_entry,
                        stop_loss: dispatchResult.analysis.suggested_stop_loss,
                        take_profit: dispatchResult.analysis.suggested_take_profit,
                        decision_id: dispatchResult.decisionRecordId,
                    });
                }
                if (retestOpportunity) {
                    await (0, transition_breakout_retest_service_1.recordTransitionRetestDispatch)({
                        opportunity: retestOpportunity,
                        decision: 'trade',
                        reason: dispatchResult.reason,
                        executionAttempted: true,
                        executionSuccess: execResult.success,
                        executionReason: execResult.reason,
                        decisionRecordId: dispatchResult.decisionRecordId,
                    });
                }
            }
        }
        console.log('[LLMDispatch] LLM dispatch completed');
    }
    catch (error) {
        console.error('[LLMDispatch] Error during LLM dispatch:', error);
    }
    finally {
        isRunning = false;
    }
}
/**
 * Start LLM dispatch scheduler
 */
function startLLMDispatchScheduler(cronExpression = v3_schedulers_1.V3_LLM_DISPATCH_CRON) {
    if (llmDispatchTask) {
        console.warn('[LLMDispatch] Scheduler already running');
        return;
    }
    console.log(`[LLMDispatch] Starting scheduler with cron: ${cronExpression}`);
    // Catch delayed ticks using current eligibility/scans; the in-flight guard and durable
    // retest claims prevent replaying multiple orders after a stall.
    let lastScheduledSecond = -1;
    llmDispatchTask = node_cron_1.default.schedule(cronExpression, (scheduledAt) => {
        const second = Math.floor((scheduledAt instanceof Date ? scheduledAt.getTime() : Date.now()) / 1000);
        if (second <= lastScheduledSecond)
            return;
        lastScheduledSecond = second;
        void runLLMDispatch();
    }, { recoverMissedExecutions: true });
    // Don't run immediately - wait for market scan to populate data
}
/**
 * Stop LLM dispatch scheduler
 */
function stopLLMDispatchScheduler() {
    if (llmDispatchTask) {
        llmDispatchTask.stop();
        llmDispatchTask = null;
        console.log('[LLMDispatch] Scheduler stopped');
    }
}
/**
 * Run LLM dispatch manually (for testing)
 */
async function runManualLLMDispatch() {
    return await runLLMDispatch();
}
//# sourceMappingURL=llm-dispatch.scheduler.js.map