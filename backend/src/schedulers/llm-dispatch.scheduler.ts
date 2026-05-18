/**
 * LLM Dispatch Scheduler
 * Processes valid signals from market scan and dispatches to Groq
 * Only processes signals that passed the signal gate
 */

import cron, { type ScheduledTask } from 'node-cron';
import { V3_LLM_DISPATCH_CRON } from '../config/v3-schedulers';
import { groqDispatchService } from '../services/groq-dispatch.service';
import { getScanResult } from './market-scan.scheduler';
import { getMethodConfig } from '../config/methods';
import { getOrCreateTestnetAccount, createTestnetPosition } from '../repositories/testnet.repository';

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
          console.log(`[LLMDispatch] ${symbol} ${timeframe}: Signal gate skip (no Groq), continuing`);
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
          method_id: 'kim_nghia',
          signalResult: scanResult.signalResult,
        });

        console.log(`[LLMDispatch] ${symbol} ${timeframe}: ${dispatchResult.decision.toUpperCase()} - ${dispatchResult.reason}`);

        // If trade decision, execute trade logic by creating a position
        if (dispatchResult.decision === 'trade' && dispatchResult.analysis) {
          console.log(`[LLMDispatch] Trade signal received for ${symbol} ${timeframe}`);
          console.log(`[LLMDispatch] Action: ${dispatchResult.analysis.action}, Bias: ${dispatchResult.analysis.bias}, Confidence: ${(dispatchResult.analysis.confidence * 100).toFixed(0)}%`);
          
          if (dispatchResult.analysis.suggested_entry) {
            console.log(`[LLMDispatch] Entry: ${dispatchResult.analysis.suggested_entry}, SL: ${dispatchResult.analysis.suggested_stop_loss}, TP: ${dispatchResult.analysis.suggested_take_profit}`);
            
            try {
              // Ensure account exists
              const account = await getOrCreateTestnetAccount(symbol, 'kim_nghia', 10000);
              
              const entryPrice = dispatchResult.analysis.suggested_entry;
              const stopLoss = dispatchResult.analysis.suggested_stop_loss || (entryPrice * 0.99);
              const takeProfit = dispatchResult.analysis.suggested_take_profit || (entryPrice * 1.02);
              const side = dispatchResult.analysis.action === 'buy' ? 'LONG' : 'SHORT';
              
              // Calculate fixed $100 size for now
              const sizeUsd = 100;
              const sizeQty = sizeUsd / entryPrice;
              const expectedRr = Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss);
              
              await createTestnetPosition({
                positionId: `pos_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                accountId: account.id,
                symbol: symbol,
                side: side,
                entryPrice: entryPrice,
                stopLoss: stopLoss,
                takeProfit: takeProfit,
                sizeUsd: sizeUsd,
                sizeQty: sizeQty,
                riskUsd: sizeUsd * 0.1, // 10% risk
                riskPercent: 1.0,
                expectedRr: expectedRr,
                linkedPredictionId: undefined
              });
              
              console.log(`[LLMDispatch] Successfully created testnet position for ${symbol}`);
            } catch (tradeErr: any) {
              console.error(`[LLMDispatch] Failed to create testnet position:`, tradeErr.message);
            }
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
