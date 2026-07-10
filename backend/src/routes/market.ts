/**
 * Market Data Routes
 * Provides candle data, indicators, setups, and signals for the dashboard
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { readCache, MARKET_READ_TTL_MS } from '../lib/read-cache';
import { getCandles, toChartCandles, type UnifiedCandle } from '../services/candle.service';

const router = Router();

function computeLatestIndicators(candles: UnifiedCandle[]) {
  const emptyLatest = {
    sma20: null as number | null,
    sma50: null as number | null,
    rsi14: null as number | null,
    atr14: null as number | null,
  };

  if (candles.length < 50) {
    return emptyLatest;
  }

  const calculateSMA = (data: number[], period: number): number[] => {
    const result: number[] = [];
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
    return Array(period - 1).fill(null).concat(result);
  };

  const closes = candles.map((c) => c.close);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);

  const calculateRSI = (data: number[], period = 14): number[] => {
    const result: number[] = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }

      if (i >= period) {
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);
        result.push(rsi);

        const oldChange = data[i - period + 1] - data[i - period];
        if (oldChange > 0) {
          gains -= oldChange;
        } else {
          losses += oldChange;
        }
      }
    }

    return Array(period).fill(null).concat(result);
  };

  const rsi14 = calculateRSI(closes, 14);

  const calculateATR = (bars: UnifiedCandle[], period = 14): number[] => {
    const result: number[] = [];
    const trueRanges: number[] = [];

    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].high;
      const low = bars[i].low;
      const prevClose = bars[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    for (let i = period - 1; i < trueRanges.length; i++) {
      const sum = trueRanges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }

    return Array(period).fill(null).concat(result);
  };

  const atr14 = calculateATR(candles, 14);

  const lastNum = (arr: (number | null)[]): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    }
    return null;
  };

  return {
    sma20: lastNum(sma20),
    sma50: lastNum(sma50),
    rsi14: lastNum(rsi14),
    atr14: lastNum(atr14),
  };
}

/**
 * GET /api/market/candles
 * Get candle data for a symbol and timeframe
 */
router.get('/candles', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol = 'BTC', timeframe = '15m', limit = 100 } = req.query;
    const tf = String(timeframe);
    const limitNum = parseInt(String(limit), 10);

    const sym = String(symbol).toUpperCase();
    const { candles, source } = await readCache.get(
      `market:candles:${sym}:${tf}:${limitNum}`,
      MARKET_READ_TTL_MS,
      () =>
        getCandles({
          symbol: sym,
          timeframe: tf,
          limit: limitNum,
        })
    );

    res.json({
      ok: true,
      symbol: sym,
      timeframe: tf,
      candles: toChartCandles(candles),
      source,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch candles';
    console.error('[MarketRoutes] Error fetching candles:', message);
    res.status(500).json({ ok: false, error: 'Failed to fetch candles' });
  }
});

/**
 * GET /api/market/indicators
 * Get technical indicators for a symbol and timeframe
 */
router.get('/indicators', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol = 'BTC', timeframe = '15m' } = req.query;
    const sym = String(symbol).toUpperCase();
    const tf = String(timeframe);

    const { candles, source } = await readCache.get(
      `market:candles:${sym}:${tf}:100`,
      MARKET_READ_TTL_MS,
      () =>
        getCandles({
          symbol: sym,
          timeframe: tf,
          limit: 100,
        })
    );

    const latest = computeLatestIndicators(candles);

    res.json({
      ok: true,
      symbol: sym,
      timeframe: tf,
      latest,
      source,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to calculate indicators';
    console.error('[MarketRoutes] Error calculating indicators:', message);
    res.status(200).json({
      ok: true,
      symbol: String(req.query.symbol || 'BTC').toUpperCase(),
      timeframe: String(req.query.timeframe || '15m'),
      latest: { sma20: null, sma50: null, rsi14: null, atr14: null },
    });
  }
});

/**
 * GET /api/market/setups
 * Get recent trading setups from analysis history
 */
router.get('/setups', async (req: Request, res: Response) => {
  try {
    const { symbol = 'BTC', limit = 10 } = req.query;

    const analyses = await prisma.analysisHistory.findMany({
      where: {
        coin: String(symbol).toUpperCase(),
        action: { in: ['buy', 'sell'] },
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(String(limit)),
    });

    const setups = analyses.map((analysis) => ({
      id: analysis.id.toString(),
      timestamp: analysis.timestamp.toISOString(),
      action: analysis.action,
      bias: analysis.bias,
      confidence: analysis.confidence,
      suggested_entry: analysis.suggested_entry,
      stop_loss: analysis.suggested_stop_loss,
      take_profit: analysis.suggested_take_profit,
      expected_rr: analysis.expected_rr,
      invalidation_level: analysis.invalidation_level,
      reason_summary: (analysis as { reason_summary?: string }).reason_summary || analysis.narrative,
    }));

    res.json({
      ok: true,
      symbol: String(symbol).toUpperCase(),
      setups,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch setups';
    console.error('[MarketRoutes] Error fetching setups:', message);
    res.status(500).json({ ok: false, error: 'Failed to fetch setups' });
  }
});

/**
 * GET /api/market/signals
 * Get recent signal gate decisions
 */
router.get('/signals', async (req: Request, res: Response) => {
  try {
    const { symbol = 'BTC', limit = 10 } = req.query;

    const sym = String(symbol).toUpperCase();
    const take = parseInt(String(limit), 10);

    const signals = await readCache.get(
      `market:signals:${sym}:${take}`,
      MARKET_READ_TTL_MS,
      async () => {
        const decisions = await prisma.tradeDecision.findMany({
          where: { symbol: sym },
          orderBy: { timestamp: 'desc' },
          take,
        });

        return decisions.map((decision) => ({
      id: decision.id.toString(),
      timestamp: decision.timestamp.toISOString(),
      grade: decision.grade,
      confidence: decision.confidence,
      playbook: decision.playbook_key,
      regime: decision.regime,
      pass: decision.decision === 'trade',
      reasonCodes: decision.reason ? [decision.reason.substring(0, 50)] : [],
        }));
      }
    );

    res.json({
      ok: true,
      symbol: sym,
      signals,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch signals';
    console.error('[MarketRoutes] Error fetching signals:', message);
    res.status(500).json({ ok: false, error: 'Failed to fetch signals' });
  }
});

export default router;
