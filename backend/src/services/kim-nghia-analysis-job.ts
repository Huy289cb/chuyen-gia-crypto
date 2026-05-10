import { prisma } from '../lib/prisma';
import { createAnalyzer } from '../analyzers/analyzerFactory';
import { getMethodConfig } from '../config/methods';
import { cache } from '../cache';
import { fetchHistoricalCandles, fetchRealTimePrices } from './price-fetcher';

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
      await prisma.analysisHistory.create({
        data: {
          coin: 'BTC',
          timestamp: new Date(),
          current_price: priceData.btc?.price || 0,
          bias: analysis.btc?.bias || 'neutral',
          action: analysis.btc?.action || 'hold',
          confidence: analysis.btc?.confidence || 0,
          narrative: analysis.btc?.narrative,
          method_id: 'kim_nghia',
          raw_question: analysis.raw_question,
          raw_answer: analysis.raw_answer,
        },
      });

      await prisma.analysisHistory.create({
        data: {
          coin: 'ETH',
          timestamp: new Date(),
          current_price: priceData.eth?.price || 0,
          bias: analysis.eth?.bias || 'neutral',
          action: analysis.eth?.action || 'hold',
          confidence: analysis.eth?.confidence || 0,
          narrative: analysis.eth?.narrative,
          method_id: 'kim_nghia',
          raw_question: analysis.raw_question,
          raw_answer: analysis.raw_answer,
        },
      });
    }

    return { success: true, data: cachedData };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
