/**
 * Market Data Routes
 * Provides candle data, indicators, setups, and signals for the dashboard
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { fetchHistoricalCandles } from '../services/price-fetcher';
import { getOhlcvCandles } from '../repositories/market.repository';

const router = Router();

/**
 * GET /api/market/candles
 * Get candle data for a symbol and timeframe
 */
router.get('/candles', async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol = 'BTC', timeframe = '15m', limit = 100 } = req.query;

    // Try to fetch from database first
    const dbCandles = await getOhlcvCandles(
      String(symbol),
      168, // 7 days back
      String(timeframe)
    );

    // If we have enough candles in DB, return them
    if (dbCandles.length >= parseInt(String(limit))) {
      const formattedCandles = dbCandles
        .slice(-parseInt(String(limit)))
        .map((candle) => ({
          time: Math.floor(new Date(candle.timestamp).getTime() / 1000),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0,
        }));

      res.json({
        ok: true,
        symbol: String(symbol).toUpperCase(),
        timeframe: String(timeframe),
        candles: formattedCandles,
      });
      return;
    }

    // Otherwise, fetch from Binance API
    const binanceCandles = await fetchHistoricalCandles(
      String(symbol),
      String(timeframe),
      parseInt(String(limit))
    );

    const formattedCandles = binanceCandles.map((kline: any[]) => ({
      time: Math.floor(kline[0] / 1000),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));

    res.json({
      ok: true,
      symbol: String(symbol).toUpperCase(),
      timeframe: String(timeframe),
      candles: formattedCandles,
    });
  } catch (error: any) {
    console.error('[MarketRoutes] Error fetching candles:', error.message);
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

    // Fetch candles
    const candles = await getOhlcvCandles(String(symbol), 168, String(timeframe));

    if (candles.length < 50) {
      res.json({
        ok: true,
        symbol: String(symbol).toUpperCase(),
        timeframe: String(timeframe),
        indicators: {
          sma20: [],
          sma50: [],
          rsi14: [],
          atr14: [],
        },
        latest: {
          sma20: null,
          sma50: null,
          rsi14: null,
          atr14: null,
        },
      });
      return;
    }

    // Calculate SMA
    const calculateSMA = (data: number[], period: number): number[] => {
      const result: number[] = [];
      for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
      }
      // Pad with null for the first period-1 values
      return Array(period - 1).fill(null).concat(result);
    };

    const closes = candles.map((c) => c.close);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);

    // Calculate RSI
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

          // Remove oldest from averages
          const oldChange = data[i - period + 1] - data[i - period];
          if (oldChange > 0) {
            gains -= oldChange;
          } else {
            losses += oldChange;
          }
        }
      }

      // Pad with null for the first period values
      return Array(period).fill(null).concat(result);
    };

    const rsi14 = calculateRSI(closes, 14);

    // Calculate ATR
    const calculateATR = (candles: any[], period = 14): number[] => {
      const result: number[] = [];
      const trueRanges: number[] = [];

      for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;

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

      // Pad with null for the first period values
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

    res.json({
      ok: true,
      symbol: String(symbol).toUpperCase(),
      timeframe: String(timeframe),
      indicators: {
        sma20,
        sma50,
        rsi14,
        atr14,
      },
      latest: {
        sma20: lastNum(sma20),
        sma50: lastNum(sma50),
        rsi14: lastNum(rsi14),
        atr14: lastNum(atr14),
      },
    });
  } catch (error: any) {
    console.error('[MarketRoutes] Error calculating indicators:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to calculate indicators' });
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
      reason_summary: (analysis as any).reason_summary || analysis.narrative,
    }));

    res.json({
      ok: true,
      symbol: String(symbol).toUpperCase(),
      setups,
    });
  } catch (error: any) {
    console.error('[MarketRoutes] Error fetching setups:', error.message);
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

    const decisions = await prisma.tradeDecision.findMany({
      where: {
        symbol: String(symbol).toUpperCase(),
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(String(limit)),
    });

    const signals = decisions.map((decision) => ({
      id: decision.id.toString(),
      timestamp: decision.timestamp.toISOString(),
      grade: decision.grade,
      confidence: decision.confidence,
      playbook: decision.playbook_key,
      regime: decision.regime,
      pass: decision.decision === 'trade',
      reasonCodes: decision.reason ? [decision.reason.substring(0, 50)] : [],
    }));

    res.json({
      ok: true,
      symbol: String(symbol).toUpperCase(),
      signals,
    });
  } catch (error: any) {
    console.error('[MarketRoutes] Error fetching signals:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch signals' });
  }
});

export default router;
