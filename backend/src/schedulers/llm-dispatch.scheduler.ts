/**
 * LLM Dispatch Scheduler
 * Processes valid signals from market scan and dispatches to Groq
 * Only processes signals that passed the signal gate
 */

import cron, { type ScheduledTask } from 'node-cron';
import { V3_LLM_DISPATCH_CRON } from '../config/v3-schedulers';
import { groqDispatchService } from '../services/groq-dispatch.service';
import { getScanResult, type MarketScanResult } from './market-scan.scheduler';
import { getMethodConfig } from '../config/methods';
import { executeV3Trade } from '../services/v3-trade-execution.service';
import { hookLlmDispatchSummary } from '../services/telegram/telegram-hooks';
import { memoryService } from '../services/memory.service';
import {
  getTestnetPendingOrders,
  getTestnetPositions,
  recordPipelineEvent,
} from '../repositories/testnet.repository';
import { formatLlmTradeSummary } from '../utils/trade-levels';
import { compareSignalGateEvaluations } from '../utils/signal-gate-ranking';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';

let llmDispatchTask: ScheduledTask | null = null;
let isRunning = false;

const V3_TIMEFRAMES = ['15m', '1h', '4h'] as const;

function pickBestScanResult(
  symbol: string
): { timeframe: string; scanResult: MarketScanResult } | null {
  const candidates: Array<{ timeframe: string; scanResult: MarketScanResult }> = [];

  for (const timeframe of V3_TIMEFRAMES) {
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
    compareSignalGateEvaluations(
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
      const [openPositions, pendingOrders] = await Promise.all([
        getTestnetPositions({ symbol, status: 'open' }),
        getTestnetPendingOrders({ symbol, status: 'pending' }),
      ]);
      if (openPositions.length > 0 || pendingOrders.length > 0) {
        console.log(
          `[LLMDispatch] ${symbol}: skip dispatch — open=${openPositions.length} pending=${pendingOrders.length}`
        );
        continue;
      }

      const picked = pickBestScanResult(symbol);
      if (!picked) {
        continue;
      }

      const { timeframe, scanResult } = picked;
      const methodConfig = getMethodConfig('kim_nghia');

      const dispatchResult = await groqDispatchService.dispatch({
        symbol,
        timeframe,
        candles: scanResult.candles,
        systemPrompt: methodConfig.systemPrompt,
        method_id: 'kim_nghia',
        signalResult: scanResult.signalResult,
      });

      console.log(`[LLMDispatch] ${symbol} ${timeframe}: ${dispatchResult.decision.toUpperCase()} - ${dispatchResult.reason}`);

      let execState: 'pending_placed' | 'exec_failed' | 'none' = 'none';
      let execDetail: string | undefined;
      let orderId: string | undefined;
      let binanceOrderId: string | undefined;

      if (dispatchResult.decision === 'no_trade') {
        const isRiskPreBlock =
          dispatchResult.reason.includes('Risk engine blocked') ||
          dispatchResult.reason.includes('SL distance');
        if (isRiskPreBlock && dispatchResult.analysis) {
          await recordPipelineEvent('execution_blocked', {
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
      }

      if (dispatchResult.decision === 'trade' && dispatchResult.analysis) {
        console.log(`[LLMDispatch] Trade signal received for ${symbol} ${timeframe}`);
        console.log(
          `[LLMDispatch] Action: ${dispatchResult.analysis.action}, Bias: ${dispatchResult.analysis.bias}, ` +
            `Confidence: ${((dispatchResult.analysis.confidence ?? 0) * 100).toFixed(0)}%`
        );

        const execResult = await executeV3Trade({
          symbol,
          timeframe,
          analysis: dispatchResult.analysis,
          methodId: 'kim_nghia',
          decisionRecordId: dispatchResult.decisionRecordId,
        });

        if (execResult.success) {
          execState = 'pending_placed';
          orderId = execResult.orderId != null ? String(execResult.orderId) : undefined;
          binanceOrderId = execResult.binanceOrderId != null ? String(execResult.binanceOrderId) : undefined;
          console.log(
            `[LLMDispatch] Binance pending order ${execResult.orderId} ` +
              `(binance=${execResult.binanceOrderId}) for ${symbol}`
          );
        } else {
          execState = 'exec_failed';
          execDetail = execResult.reason;
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
      }

      hookLlmDispatchSummary({
        symbol,
        timeframe,
        decision: dispatchResult.decision,
        reason: dispatchResult.reason,
        tradeSummary:
          dispatchResult.analysis != null
            ? formatLlmTradeSummary(dispatchResult.analysis)
            : undefined,
        execution: execState,
        executionDetail: execDetail,
        orderId,
        binanceOrderId,
      });
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
  llmDispatchTask = cron.schedule(cronExpression, runLLMDispatch);

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
