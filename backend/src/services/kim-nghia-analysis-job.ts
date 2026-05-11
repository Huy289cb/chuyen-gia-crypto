import { createAnalyzer } from '../analyzers/analyzerFactory';
import { getMethodConfig } from '../config/methods';
import { cache } from '../cache';
import { fetchHistoricalCandles, fetchRealTimePrices } from './price-fetcher';
import { saveAnalysis } from '../repositories/analysis.repository';
import {
  cancelTestnetPendingOrder,
  createTestnetPendingOrder,
  getOrCreateTestnetAccount,
  getTestnetPendingOrders,
  getTestnetPositions,
  updateTestnetPendingOrder,
} from '../repositories/testnet.repository';
import { prisma } from '../lib/prisma';
import {
  initTestnetClient,
  placeLimitOrder,
} from './binanceClient';
import { getPositionSide } from './binance-hedge-mode';

export type KimNghiaAnalysisJobResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Runs Kim Nghia Groq analysis, updates cache, and persists BTC/ETH rows.
 * Used by POST /api/analysis/run and the worker CRON_SCHEDULE job.
 */
export async function runKimNghiaAnalysisJob(): Promise<KimNghiaAnalysisJobResult> {
  try {
    const priceData: any = await fetchRealTimePrices();

    const btcCandles = await fetchHistoricalCandles('BTC', '1d', 24);
    const ethCandles = await fetchHistoricalCandles('ETH', '1d', 24);

    if (btcCandles && btcCandles.length > 0) {
      priceData.btc.prices1d = btcCandles.map((k: any[]) => parseFloat(k[4]));
    }
    if (ethCandles && ethCandles.length > 0) {
      priceData.eth.prices1d = ethCandles.map((k: any[]) => parseFloat(k[4]));
    }

    const methodConfig = getMethodConfig('kim_nghia');
    const analyzer: any = createAnalyzer(methodConfig);
    const analysis = await analyzer.analyze(priceData, true);

    const cachedData = {
      prices: priceData,
      analysis,
      lastUpdated: priceData.timestamp,
    };
    cache.set(cachedData);

    if (analysis) {
      const btcSaved = await saveAnalysis({
        coin: 'BTC',
        currentPrice: priceData.btc?.price || 0,
        bias: analysis.btc?.bias || 'neutral',
        action: analysis.btc?.action || 'hold',
        confidence: analysis.btc?.confidence || 0,
        narrative: analysis.btc?.narrative,
        methodId: 'kim_nghia',
        suggestedEntry: analysis.btc?.suggested_entry ?? undefined,
        suggestedStopLoss: analysis.btc?.suggested_stop_loss ?? undefined,
        suggestedTakeProfit: analysis.btc?.suggested_take_profit ?? undefined,
        expectedRr: analysis.btc?.expected_rr ?? undefined,
        rawQuestion: analysis.raw_question,
        rawAnswer: analysis.raw_answer,
        positionDecisions: analysis.btc?.position_decisions
          ? JSON.stringify(analysis.btc.position_decisions)
          : undefined,
        pendingOrderDecisions: analysis.btc?.pending_order_decisions
          ? JSON.stringify(analysis.btc.pending_order_decisions)
          : undefined,
      });

      await saveAnalysis({
        coin: 'ETH',
        currentPrice: priceData.eth?.price || 0,
        bias: analysis.eth?.bias || 'neutral',
        action: analysis.eth?.action || 'hold',
        confidence: analysis.eth?.confidence || 0,
        narrative: analysis.eth?.narrative,
        methodId: 'kim_nghia',
        suggestedEntry: analysis.eth?.suggested_entry ?? undefined,
        suggestedStopLoss: analysis.eth?.suggested_stop_loss ?? undefined,
        suggestedTakeProfit: analysis.eth?.suggested_take_profit ?? undefined,
        expectedRr: analysis.eth?.expected_rr ?? undefined,
        rawQuestion: analysis.raw_question,
        rawAnswer: analysis.raw_answer,
      });

      await maybeCreateKimNghiaPendingOrder({
        analysisId: btcSaved.analysisId,
        analysisBtc: analysis.btc,
      });

      await maybeProcessPendingOrderDecisions({
        analysisBtc: analysis.btc,
      });

      await maybeProcessPositionDecisions({
        analysisBtc: analysis.btc,
      });
    }

    return { success: true, data: cachedData };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function maybeCreateKimNghiaPendingOrder({
  analysisId,
  analysisBtc,
}: {
  analysisId: number;
  analysisBtc: any;
}): Promise<void> {
  if (!analysisBtc) return;

  const methodConfig = getMethodConfig('kim_nghia');
  const auto = methodConfig.autoEntry;

  const action = String(analysisBtc.action || '').toLowerCase();
  const confidencePct = (Number(analysisBtc.confidence) || 0) * 100;
  const rr = Number(analysisBtc.expected_rr) || 0;

  console.log(`[KimNghiaAutoEntry] Checking order creation: action=${action} confidence=${confidencePct}% (min=${auto.minConfidence}) rr=${rr} (min=${auto.minRRRatio})`);

  if ((action !== 'buy' && action !== 'sell') || confidencePct < auto.minConfidence || rr < auto.minRRRatio) {
    console.log(`[KimNghiaAutoEntry] Order creation skipped: action=${action} confidence=${confidencePct}% < ${auto.minConfidence}% or rr=${rr} < ${auto.minRRRatio}`);
    return;
  }

  const entry = Number(analysisBtc.suggested_entry);
  const stopLoss = Number(analysisBtc.suggested_stop_loss);
  const takeProfit = Number(analysisBtc.suggested_take_profit);
  if (!isValidNumber(entry) || !isValidNumber(stopLoss) || !isValidNumber(takeProfit)) {
    console.log(`[KimNghiaAutoEntry] Order creation skipped: invalid entry/SL/TP values`);
    return;
  }

  const account = await getOrCreateTestnetAccount('BTC', 'kim_nghia', 100);
  const [openPositions, pendingOrders] = await Promise.all([
    getTestnetPositions({ symbol: 'BTC', status: 'open', methodId: 'kim_nghia' }),
    getTestnetPendingOrders({ symbol: 'BTC', status: 'pending', methodId: 'kim_nghia' }),
  ]);

  console.log(`[KimNghiaAutoEntry] Current state: openPositions=${openPositions.length}/${auto.maxPositionsPerSymbol} pendingOrders=${pendingOrders.length}/${auto.maxPositionsPerSymbol}`);

  if (openPositions.length >= auto.maxPositionsPerSymbol || pendingOrders.length >= auto.maxPositionsPerSymbol) {
    console.log(`[KimNghiaAutoEntry] Order creation skipped: max positions/orders limit reached`);
    return;
  }

  const pendingVolume = pendingOrders.reduce((sum, o) => sum + (Number(o.size_usd) || 0), 0);
  console.log(`[KimNghiaAutoEntry] Pending volume: ${pendingVolume}/${auto.maxPendingVolume}`);
  if (pendingVolume >= auto.maxPendingVolume) {
    console.log(`[KimNghiaAutoEntry] Order creation skipped: max pending volume reached`);
    return;
  }

  const riskUsd = Math.max(1, Number(account.current_balance || 0) * auto.riskPerTrade);
  const slDistancePct = Math.abs(entry - stopLoss) / entry;
  console.log(`[KimNghiaAutoEntry] SL distance: ${slDistancePct.toFixed(4)} (min=${auto.minSLDistancePercent})`);
  // Add epsilon tolerance for floating point precision
  const epsilon = 0.0001;
  if (slDistancePct < auto.minSLDistancePercent - epsilon) {
    console.log(`[KimNghiaAutoEntry] Order creation skipped: SL distance too small`);
    return;
  }

  const side = action === 'buy' ? 'long' : 'short';
  const computedSizeUsd = riskUsd / slDistancePct;
  const remainingPendingCapacity = Math.max(0, auto.maxPendingVolume - pendingVolume);
  const sizeUsd = Math.min(computedSizeUsd, auto.maxPendingOrderSize, remainingPendingCapacity);
  console.log(`[KimNghiaAutoEntry] Computed size: computed=${computedSizeUsd.toFixed(2)} maxOrder=${auto.maxPendingOrderSize} remaining=${remainingPendingCapacity.toFixed(2)} final=${sizeUsd.toFixed(2)}`);
  if (sizeUsd <= 0) {
    console.log(`[KimNghiaAutoEntry] Order creation skipped: computed size <= 0`);
    return;
  }

  const sizeQty = sizeUsd / entry;
  const orderId = `kn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Phase 7: Idempotency protection - use unique newClientOrderId
  // This prevents duplicate orders on retries
  const newClientOrderId = `x-${orderId}`;
  
  let binanceOrderId: string | undefined;
  
  // Place real Binance order if BINANCE_ENABLED is true
  if (process.env.BINANCE_ENABLED === 'true') {
    const client = initTestnetClient();
    if (!client) {
      throw new Error('Binance client unavailable - cannot place real order');
    }

    const binanceSide = side === 'long' ? 'BUY' : 'SELL';
    // Phase 8: Use detected positionSide for hedge mode compatibility
    const positionSide = getPositionSide(side);

    try {
      const order = await placeLimitOrder(
        client,
        'BTCUSDT',
        binanceSide,
        sizeQty,
        entry,
        positionSide,
        newClientOrderId, // Pass newClientOrderId for idempotency
      );
      binanceOrderId = String(order.orderId);
      console.log(`[KimNghiaAutoEntry] Placed Binance order ${binanceOrderId} (clientOrderId: ${newClientOrderId}, positionSide: ${positionSide || 'N/A'}) for pending order ${orderId}`);
    } catch (error: any) {
      console.error(`[KimNghiaAutoEntry] Failed to place Binance order: ${error.message}`);
      // Phase 7: Check if order already exists (duplicate prevention)
      if (error.message && error.message.includes('Duplicate order')) {
        console.log(`[KimNghiaAutoEntry] Order with clientOrderId ${newClientOrderId} already exists, fetching existing order...`);
        // Could fetch the existing order here, but for now we'll re-throw
        // In a full implementation, we would query the order by clientOrderId
      }
      throw new Error(`Binance order placement failed: ${error.message}`);
    }
  }
  
  await createTestnetPendingOrder({
    orderId,
    accountId: account.id,
    symbol: 'BTC',
    side,
    entryPrice: entry,
    stopLoss,
    takeProfit,
    sizeUsd,
    sizeQty,
    riskUsd,
    riskPercent: auto.riskPerTrade * 100,
    expectedRr: rr,
    linkedPredictionId: analysisId,
    invalidationLevel: isValidNumber(analysisBtc.invalidation_level) ? analysisBtc.invalidation_level : undefined,
    methodId: 'kim_nghia',
    binanceOrderId,
  });

  console.log(
    `[KimNghiaAutoEntry] Created pending order ${orderId} side=${side} entry=${entry.toFixed(2)} sl=${stopLoss.toFixed(2)} tp=${takeProfit.toFixed(2)} sizeUsd=${sizeUsd.toFixed(2)}`
  );
}

async function maybeProcessPendingOrderDecisions({
  analysisBtc,
}: {
  analysisBtc: any;
}): Promise<void> {
  if (!analysisBtc) return;

  const decisions = analysisBtc?.pending_order_decisions;
  if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
    return;
  }

  const confidenceThreshold = Number(process.env.KIM_NGHIA_CONFIDENCE_THRESHOLD) || 0.82;

  for (const decision of decisions) {
    const { order_id, action, confidence, reason, new_sl, new_tp, new_entry } = decision;

    if (!order_id || !action) continue;

    const confidenceValue = Number(confidence) || 0;
    if (confidenceValue < confidenceThreshold) {
      console.log(`[KimNghiaPendingOrderDecision] Skipping ${action} for order ${order_id} - confidence ${(confidenceValue * 100).toFixed(0)}% < threshold ${(confidenceThreshold * 100).toFixed(0)}%`);
      continue;
    }

    try {
      if (action === 'cancel') {
        await cancelTestnetPendingOrder(order_id, reason || 'AI decision');
        console.log(`[KimNghiaPendingOrderDecision] Cancelled order ${order_id}: ${reason}`);
      } else if (action === 'modify') {
        const pendingOrders = await getTestnetPendingOrders({ orderId: order_id });
        if (!pendingOrders || pendingOrders.length === 0) {
          console.log(`[KimNghiaPendingOrderDecision] Order ${order_id} not found, skipping modify`);
          continue;
        }

        const order = pendingOrders[0];
        const entryPrice = Number(order.entry_price);
        const side = order.side;

        const updates: any = {};
        let isValid = true;

        if (new_entry) {
          const newEntryValue = Number(new_entry);
          if (isNaN(newEntryValue)) {
            isValid = false;
          } else {
            updates.entry_price = newEntryValue;
          }
        }

        if (new_sl) {
          const newSlValue = Number(new_sl);
          if (isNaN(newSlValue)) {
            isValid = false;
          } else {
            const actualEntry = updates.entry_price || entryPrice;
            const slDistance = Math.abs(newSlValue - actualEntry);
            const minDistance = actualEntry * 0.005;

            if (slDistance < minDistance) {
              console.log(`[KimNghiaPendingOrderDecision] SL too close to entry for order ${order_id}`);
              isValid = false;
            }

            if (side === 'long' && newSlValue >= actualEntry) {
              console.log(`[KimNghiaPendingOrderDecision] Long SL must be below entry`);
              isValid = false;
            }
            if (side === 'short' && newSlValue <= actualEntry) {
              console.log(`[KimNghiaPendingOrderDecision] Short SL must be above entry`);
              isValid = false;
            }

            if (isValid) {
              updates.stop_loss = newSlValue;
            }
          }
        }

        if (new_tp) {
          const newTpValue = Number(new_tp);
          if (isNaN(newTpValue)) {
            isValid = false;
          } else {
            const actualEntry = updates.entry_price || entryPrice;
            if (side === 'long' && newTpValue <= actualEntry) {
              console.log(`[KimNghiaPendingOrderDecision] Long TP must be above entry`);
              isValid = false;
            }
            if (side === 'short' && newTpValue >= actualEntry) {
              console.log(`[KimNghiaPendingOrderDecision] Short TP must be below entry`);
              isValid = false;
            }

            if (isValid) {
              updates.take_profit = newTpValue;
            }
          }
        }

        if (isValid && Object.keys(updates).length > 0) {
          await updateTestnetPendingOrder(order_id, updates);
          console.log(`[KimNghiaPendingOrderDecision] Modified order ${order_id}: ${reason}`, updates);
        }
      }
      // 'hold' action does nothing
    } catch (error: any) {
      console.error(`[KimNghiaPendingOrderDecision] Error processing ${action} for order ${order_id}:`, error.message);
    }
  }
}

async function maybeProcessPositionDecisions({
  analysisBtc,
}: {
  analysisBtc: any;
}): Promise<void> {
  if (!analysisBtc) return;

  const decisions = analysisBtc?.position_decisions;
  if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
    return;
  }

  const confidenceThreshold = Number(process.env.KIM_NGHIA_CONFIDENCE_THRESHOLD) || 0.82;

  for (const decision of decisions) {
    const { position_id, action, confidence, reason, new_sl, new_tp, close_percent } = decision;

    if (!position_id || !action) continue;

    const confidenceValue = Number(confidence) || 0;
    if (confidenceValue < confidenceThreshold) {
      console.log(`[KimNghiaPositionDecision] Skipping ${action} for position ${position_id} - confidence ${(confidenceValue * 100).toFixed(0)}% < threshold ${(confidenceThreshold * 100).toFixed(0)}%`);
      continue;
    }

    try {
      const positions = await getTestnetPositions({ positionId: position_id });
      if (!positions || positions.length === 0) {
        console.log(`[KimNghiaPositionDecision] Position ${position_id} not found`);
        continue;
      }

      const position = positions[0];
      const entryPrice = Number(position.entry_price);
      const side = position.side;
      const currentPrice = Number(position.current_price || position.entry_price);

      if (action === 'hold') {
        console.log(`[KimNghiaPositionDecision] Holding position ${position_id}`);
      } else if (action === 'close_early') {
        await prisma.testnetPosition.update({
          where: { position_id: position_id },
          data: { status: 'closed', close_price: currentPrice, close_time: new Date(), close_reason: 'AI early close' }
        });
        console.log(`[KimNghiaPositionDecision] Closed position ${position_id} early at ${currentPrice}: ${reason}`);
      } else if (action === 'close_partial') {
        const closePercentValue = Number(close_percent) || 0.5;
        if (closePercentValue <= 0 || closePercentValue > 1) {
          console.log(`[KimNghiaPositionDecision] Invalid close_percent`);
          continue;
        }
        const currentSizeUsd = Number(position.size_usd);
        const newPartialClosed = (Number(position.partial_closed) || 0) + closePercentValue;
        await prisma.testnetPosition.update({
          where: { position_id: position_id },
          data: {
            partial_closed: newPartialClosed,
            size_usd: currentSizeUsd * (1 - closePercentValue),
            size_qty: Number(position.size_qty) * (1 - closePercentValue)
          }
        });
        console.log(`[KimNghiaPositionDecision] Partially closed position ${position_id}: ${closePercentValue * 100}%`);
      } else if (action === 'move_sl') {
        const updates: any = {};
        let isValid = true;

        if (new_sl) {
          const newSlValue = Number(new_sl);
          if (isNaN(newSlValue)) {
            isValid = false;
          } else {
            const slDistance = Math.abs(newSlValue - entryPrice);
            const minDistance = entryPrice * 0.005;
            if (slDistance < minDistance) {
              console.log(`[KimNghiaPositionDecision] SL too close to entry`);
              isValid = false;
            }
            if (side === 'long' && newSlValue >= entryPrice) {
              console.log(`[KimNghiaPositionDecision] Long SL must be below entry`);
              isValid = false;
            }
            if (side === 'short' && newSlValue <= entryPrice) {
              console.log(`[KimNghiaPositionDecision] Short SL must be above entry`);
              isValid = false;
            }
            if (isValid) {
              updates.stop_loss = newSlValue;
            }
          }
        }

        if (new_tp) {
          const newTpValue = Number(new_tp);
          if (isNaN(newTpValue)) {
            isValid = false;
          } else {
            if (side === 'long' && newTpValue <= entryPrice) {
              console.log(`[KimNghiaPositionDecision] Long TP must be above entry`);
              isValid = false;
            }
            if (side === 'short' && newTpValue >= entryPrice) {
              console.log(`[KimNghiaPositionDecision] Short TP must be below entry`);
              isValid = false;
            }
            if (isValid) {
              updates.take_profit = newTpValue;
            }
          }
        }

        if (isValid && Object.keys(updates).length > 0) {
          await prisma.testnetPosition.update({
            where: { position_id: position_id },
            data: updates
          });
          console.log(`[KimNghiaPositionDecision] Moved SL/TP for position ${position_id}: ${reason}`);
        }
      } else if (action === 'reverse') {
        await prisma.testnetPosition.update({
          where: { position_id: position_id },
          data: { status: 'closed', close_price: currentPrice, close_time: new Date(), close_reason: 'AI reverse' }
        });
        console.log(`[KimNghiaPositionDecision] Reversed position ${position_id} - closed at ${currentPrice}: ${reason}`);
      }
    } catch (error: any) {
      console.error(`[KimNghiaPositionDecision] Error processing ${action} for position ${position_id}:`, error.message);
    }
  }
}
