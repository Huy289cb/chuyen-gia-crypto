import { createAnalyzer } from '../analyzers/analyzerFactory';
import { getMethodConfig } from '../config/methods';
import { cache } from '../cache';
import { fetchHistoricalCandles, fetchRealTimePrices } from './price-fetcher';
import { saveAnalysis } from '../repositories/analysis.repository';
import {
  createTestnetPendingOrder,
  getOrCreateTestnetAccount,
  getTestnetPendingOrders,
  getTestnetPositions,
} from '../repositories/testnet.repository';

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

  if ((action !== 'buy' && action !== 'sell') || confidencePct < auto.minConfidence || rr < auto.minRRRatio) {
    return;
  }

  const entry = Number(analysisBtc.suggested_entry);
  const stopLoss = Number(analysisBtc.suggested_stop_loss);
  const takeProfit = Number(analysisBtc.suggested_take_profit);
  if (!isValidNumber(entry) || !isValidNumber(stopLoss) || !isValidNumber(takeProfit)) {
    return;
  }

  const account = await getOrCreateTestnetAccount('BTC', 'kim_nghia', 100);
  const [openPositions, pendingOrders] = await Promise.all([
    getTestnetPositions({ symbol: 'BTC', status: 'open', methodId: 'kim_nghia' }),
    getTestnetPendingOrders({ symbol: 'BTC', status: 'pending', methodId: 'kim_nghia' }),
  ]);

  if (openPositions.length >= auto.maxPositionsPerSymbol || pendingOrders.length >= auto.maxPositionsPerSymbol) {
    return;
  }

  const pendingVolume = pendingOrders.reduce((sum, o) => sum + (Number(o.size_usd) || 0), 0);
  if (pendingVolume >= auto.maxPendingVolume) {
    return;
  }

  const riskUsd = Math.max(1, Number(account.current_balance || 0) * auto.riskPerTrade);
  const slDistancePct = Math.abs(entry - stopLoss) / entry;
  if (slDistancePct < auto.minSLDistancePercent) {
    return;
  }

  const side = action === 'buy' ? 'long' : 'short';
  const computedSizeUsd = riskUsd / slDistancePct;
  const remainingPendingCapacity = Math.max(0, auto.maxPendingVolume - pendingVolume);
  const sizeUsd = Math.min(computedSizeUsd, auto.maxPendingOrderSize, remainingPendingCapacity);
  if (sizeUsd <= 0) {
    return;
  }

  const sizeQty = sizeUsd / entry;
  const orderId = `kn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  });

  console.log(
    `[KimNghiaAutoEntry] Created pending order ${orderId} side=${side} entry=${entry.toFixed(2)} sl=${stopLoss.toFixed(2)} tp=${takeProfit.toFixed(2)} sizeUsd=${sizeUsd.toFixed(2)}`
  );
}
