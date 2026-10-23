/**
 * LLM Dispatch Scheduler
 * Processes valid signals from market scan and dispatches to Groq
 * Only processes signals that passed the signal gate
 */

import cron, { type ScheduledTask } from 'node-cron';
import { V3_LLM_DISPATCH_CRON } from '../config/v3-schedulers';
import { getV3SignalGateTimeframes } from '../config/v3-schedulers';
import { groqDispatchService } from '../services/groq-dispatch.service';
import { getScanResult, type MarketScanResult } from './market-scan.scheduler';
import { getMethodConfig } from '../config/methods';
import { executeV3Trade } from '../services/v3-trade-execution.service';
import { memoryService } from '../services/memory.service';
import {
  getBlockingTestnetPendingOrders,
  getTestnetPositions,
  recordPipelineEvent,
} from '../repositories/testnet.repository';
import { formatLlmTradeSummary } from '../utils/trade-levels';
import { compareSignalGateForEntry } from '../utils/signal-gate-ranking';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';
import { runPendingOrderLifecycle } from '../services/pending-order-lifecycle.service';
import { runPendingOrderReview } from '../services/pending-order-review.service';
import { canRunLlmDispatchForSymbol } from '../services/v3-entry-eligibility.service';
import { isV3ScaleInEnabled } from '../config/v3-entry-policy';
import { runAiOpportunityReview } from '../services/ai-opportunity-runtime';
import {
  claimTransitionRetestOpportunity,
  peekTransitionRetestOpportunity,
  recordTransitionRetestDispatch,
  type TransitionRetestOpportunity,
} from '../services/transition-breakout-retest.service';

let llmDispatchTask: ScheduledTask | null = null;
let isRunning = false;

function getV3Timeframes(): readonly string[] {
  return getV3SignalGateTimeframes();
}

function pickBestScanResult(
  symbol: string
): { timeframe: string; scanResult: MarketScanResult } | null {
  const candidates: Array<{ timeframe: string; scanResult: MarketScanResult }> = [];

  for (const timeframe of getV3Timeframes()) {
    const scanResult = getScanResult(symbol, timeframe);
    if (!scanResult) continue;

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

  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) =>
    compareSignalGateForEntry(
      { timeframe: a.timeframe, result: a.scanResult.signalResult },
      { timeframe: b.timeframe, result: b.scanResult.signalResult }
    )
  );
  const best = sorted[0];
  if (candidates.length > 1) {
    console.log(
      `[LLMDispatch] ${symbol}: best of [${candidates.map((c) => c.timeframe).join(', ')}] → ${best.timeframe}`
    );
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
  recordSchedulerRun('LLMDispatch');
  try {
    console.log('[LLMDispatch] Starting LLM dispatch');

    const symbols = ['BTC'];

    for (const symbol of symbols) {
      const [openPositions, blockingPending] = await Promise.all([
        getTestnetPositions({ symbol, status: 'open' }),
        getBlockingTestnetPendingOrders({ symbol }),
      ]);

      const pendingForLifecycle = blockingPending.filter((o) => o.status === 'pending');

      let cancelledThisCycle = 0;
      if (pendingForLifecycle.length > 0) {
        const lifecycle = await runPendingOrderLifecycle(symbol);
        cancelledThisCycle += lifecycle.cancelled;
        if (lifecycle.cancelled > 0) {
          console.log(
            `[LLMDispatch] ${symbol}: pending lifecycle cancelled ${lifecycle.cancelled} order(s)`
          );
        }
        const review = await runPendingOrderReview(symbol);
        cancelledThisCycle += review.cancelled;
        if (review.cancelled > 0 || review.modified > 0) {
          console.log(
            `[LLMDispatch] ${symbol}: pending LLM review cancelled=${review.cancelled} modified=${review.modified}`
          );
        }
      }

      // Never place a fresh limit in the same cycle we just cancelled — kills place/cancel spam.
      if (cancelledThisCycle > 0) {
        console.log(
          `[LLMDispatch] ${symbol}: skip new trade — cancelled ${cancelledThisCycle} pending this cycle`
        );
        continue;
      }

      const eligibility = await canRunLlmDispatchForSymbol(symbol);
      if (!eligibility.allowed) {
        console.log(`[LLMDispatch] ${symbol}: skip new trade — ${eligibility.reason}`);
        continue;
      }
      if (openPositions.length > 0 && isV3ScaleInEnabled()) {
        console.log(
          `[LLMDispatch] ${symbol}: scale-in allowed — ${eligibility.reason} open=${openPositions.length}`
        );
      }

      const aiOpportunity = await runAiOpportunityReview((tf) => getScanResult(symbol, tf));
      if (aiOpportunity.handled) {
        console.log(`[AiOpportunity] ${symbol}: ${aiOpportunity.reason}`);
        continue;
      }

      let retestOpportunity: TransitionRetestOpportunity | null = null;
      let timeframe: string;
      let scanResult: MarketScanResult;
      const readyRetest = peekTransitionRetestOpportunity(symbol);
      const readyScan = readyRetest
        ? getScanResult(symbol, readyRetest.timeframe)
        : undefined;

      if (readyRetest && readyScan) {
        const claimed = await claimTransitionRetestOpportunity(readyRetest.candidate_key);
        if (!claimed) continue;
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
        console.log(
          `[LLMDispatch] ${symbol} ${timeframe}: prioritizing ${claimed.mode} ` +
            `${claimed.candidate_kind} retest ${claimed.candidate_key}`
        );
      } else {
        const picked = pickBestScanResult(symbol);
        if (!picked) continue;
        timeframe = picked.timeframe;
        scanResult = picked.scanResult;
      }

      const methodConfig = getMethodConfig('kim_nghia');

      const dispatchResult = await groqDispatchService.dispatch({
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
        const isRiskPreBlock =
          dispatchResult.reason.includes('Risk engine blocked') ||
          dispatchResult.reason.includes('SL distance');
        if (isRiskPreBlock && dispatchResult.analysis) {
          await recordPipelineEvent('execution_blocked', {
            ...dispatchResult.trace,
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
          await recordTransitionRetestDispatch({
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
        console.log(
          `[LLMDispatch] Action: ${dispatchResult.analysis.action}, Bias: ${dispatchResult.analysis.bias}, ` +
            `Confidence: ${((dispatchResult.analysis.confidence ?? 0) * 100).toFixed(0)}%`
        );

        if (retestOpportunity && retestOpportunity.mode !== 'live') {
          console.log(
            `[LLMDispatch] ${symbol} ${timeframe}: retest LLM confirmed in ${retestOpportunity.mode}; ` +
              `execution intentionally skipped`
          );
          await recordTransitionRetestDispatch({
            opportunity: retestOpportunity,
            decision: 'trade',
            reason: dispatchResult.reason,
            executionAttempted: false,
            executionReason: `${retestOpportunity.mode} does not execute`,
            decisionRecordId: dispatchResult.decisionRecordId,
          });
          continue;
        }

        const execResult = await executeV3Trade({
          symbol,
          timeframe,
          analysis: dispatchResult.analysis,
          trace: dispatchResult.trace,
          methodId: 'kim_nghia',
          decisionRecordId: dispatchResult.decisionRecordId,
          requiredMinRr: retestOpportunity?.rr ?? methodConfig.autoEntry.minRRRatio,
        });

        if (execResult.success) {
          console.log(
            `[LLMDispatch] Binance pending order ${execResult.orderId} ` +
              `(binance=${execResult.binanceOrderId}) for ${symbol}` +
              (execResult.levelAdjustment
                ? `; normalized stop ${execResult.levelAdjustment.originalStopPercent.toFixed(2)}%` +
                  `→${execResult.levelAdjustment.normalizedStopPercent.toFixed(2)}%`
                : '')
          );
        } else {
          console.warn(`[LLMDispatch] Trade execution skipped: ${execResult.reason}`);

          const summary = formatLlmTradeSummary(dispatchResult.analysis);
          if (dispatchResult.decisionRecordId) {
            await memoryService.recordExecutionBlocked(
              dispatchResult.decisionRecordId,
              symbol,
              summary,
              execResult.reason
            );
          }
          await recordPipelineEvent('execution_blocked', {
            ...dispatchResult.trace,
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
          await recordTransitionRetestDispatch({
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
  } catch (error) {
    console.error('[LLMDispatch] Error during LLM dispatch:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start LLM dispatch scheduler
 */
export function startLLMDispatchScheduler(cronExpression: string = V3_LLM_DISPATCH_CRON) {
  if (llmDispatchTask) {
    console.warn('[LLMDispatch] Scheduler already running');
    return;
  }

  console.log(`[LLMDispatch] Starting scheduler with cron: ${cronExpression}`);
  // Catch delayed ticks using current eligibility/scans; the in-flight guard and durable
  // retest claims prevent replaying multiple orders after a stall.
  let lastScheduledSecond = -1;
  llmDispatchTask = cron.schedule(cronExpression, (scheduledAt) => {
    const second = Math.floor((scheduledAt instanceof Date ? scheduledAt.getTime() : Date.now()) / 1000);
    if (second <= lastScheduledSecond) return;
    lastScheduledSecond = second;
    void runLLMDispatch();
  }, { recoverMissedExecutions: true });

  // Don't run immediately - wait for market scan to populate data
}

/**
 * Stop LLM dispatch scheduler
 */
export function stopLLMDispatchScheduler() {
  if (llmDispatchTask) {
    llmDispatchTask.stop();
    llmDispatchTask = null;
    console.log('[LLMDispatch] Scheduler stopped');
  }
}

/**
 * Run LLM dispatch manually (for testing)
 */
export async function runManualLLMDispatch() {
  return await runLLMDispatch();
}
