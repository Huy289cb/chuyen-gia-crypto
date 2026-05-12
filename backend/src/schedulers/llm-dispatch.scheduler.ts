/**
 * LLM Dispatch Scheduler
 * Processes valid signals from market scan and dispatches to Groq
 * Only processes signals that passed the signal gate
 */

import cron, { type ScheduledTask } from 'node-cron';
import { groqDispatchService } from '../services/groq-dispatch.service';
import { getScanResult } from './market-scan.scheduler';
import { getMethodConfig } from '../config/methods';

let llmDispatchTask: ScheduledTask | null = null;
let isRunning = false;

/**
 * Run LLM dispatch for valid signals
 */
async function runLLMDispatch() {
  if (isRunning) {
    console.warn('[LLMDispatch] Previous dispatch still running, skipping cycle');
    return;
  }

  isRunning = true;
  try {
    console.log('[LLMDispatch] Starting LLM dispatch');

    // Get scan results
    const symbols = ['BTC']; // BTC-only per Big Update Plan v3
    const timeframes = ['15m', '1h', '4h'];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        const scanResult = getScanResult(symbol, timeframe);
        
        if (!scanResult) {
          continue;
        }

        // Only process if signal gate passed
        if (!scanResult.signalResult.pass) {
          console.log(`[LLMDispatch] ${symbol} ${timeframe}: Signal gate blocked, skipping`);
          continue;
        }

        // Get method config for prompt
        const methodConfig = getMethodConfig('kim_nghia'); // Use active method
        
        // Dispatch to Groq
        const dispatchResult = await groqDispatchService.dispatch({
          symbol,
          timeframe,
          candles: scanResult.candles,
          systemPrompt: methodConfig.systemPrompt,
          method_id: 'kim_nghia'
        });

        console.log(`[LLMDispatch] ${symbol} ${timeframe}: ${dispatchResult.decision.toUpperCase()} - ${dispatchResult.reason}`);

        // If trade decision, execute trade logic (will be implemented in integration phase)
        if (dispatchResult.decision === 'trade' && dispatchResult.analysis) {
          console.log(`[LLMDispatch] Trade signal received for ${symbol} ${timeframe}`);
          console.log(`[LLMDispatch] Action: ${dispatchResult.analysis.action}, Bias: ${dispatchResult.analysis.bias}, Confidence: ${(dispatchResult.analysis.confidence * 100).toFixed(0)}%`);
          
          if (dispatchResult.analysis.suggested_entry) {
            console.log(`[LLMDispatch] Entry: ${dispatchResult.analysis.suggested_entry}, SL: ${dispatchResult.analysis.suggested_stop_loss}, TP: ${dispatchResult.analysis.suggested_take_profit}`);
          }
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
export function startLLMDispatchScheduler(cronExpression: string = '*/15 * * * *') {
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
