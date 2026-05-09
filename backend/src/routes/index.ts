import { Router, Request, Response, NextFunction } from 'express';
import { getLatestPrice } from '../repositories/market.repository';
import { fetchRealTimePrices } from '../services/price-fetcher';
import { prisma } from '../lib/prisma';

// Import TypeScript sub-routers
import accountsRouter from './accounts';
import positionsRouter from './positions';
import performanceRouter from './performance';
import testnetRouter from './testnet';

const router = Router();

// Middleware to inject Prisma client into routes
router.use((req: any, _res: Response, next: NextFunction) => {
  req.prisma = prisma;
  req.dbEnabled = true; // Prisma is always available
  next();
});

// ============================================================================
// TypeScript Endpoints (existing)
// ============================================================================

/**
 * GET /api/health - Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/prices - Get latest prices
 */
router.get('/prices', async (_req: Request, res: Response) => {
  try {
    const prices = await fetchRealTimePrices();
    res.json(prices);
  } catch (error: any) {
    console.error('[Routes] Error fetching prices:', error.message);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

/**
 * GET /api/analysis - Get latest market data and analysis
 */
router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const methodId = req.query.methodId as string || 'kim_nghia';

    // Fetch real-time prices
    const prices = await fetchRealTimePrices();

    // Get latest analysis for BTC and ETH
    const [btcAnalysis, ethAnalysis] = await Promise.all([
      prisma.analysisHistory.findFirst({
        where: { coin: 'BTC', method_id: methodId },
        orderBy: { timestamp: 'desc' },
        include: { predictions: true, key_levels: true },
      }),
      prisma.analysisHistory.findFirst({
        where: { coin: 'ETH', method_id: methodId },
        orderBy: { timestamp: 'desc' },
        include: { predictions: true, key_levels: true },
      }),
    ]);

    // Helper to map DB analysisHistory to frontend Analysis format
    const mapAnalysis = (record: any) => {
      if (!record) return null;
      const predictions: Record<string, any> = {};
      if (record.predictions) {
        for (const p of record.predictions) {
          predictions[p.timeframe] = {
            timeframe: p.timeframe,
            direction: p.direction,
            confidence: p.confidence,
            target: p.target_price,
            price_target: p.target_price,
            invalidation_price: record.invalidation_level,
            reasoning: p.reason_summary,
          };
        }
      }
      const keyLevels: Record<string, string> = {};
      if (record.key_levels) {
        for (const k of record.key_levels) {
          keyLevels[k.level_type] = k.description || '';
        }
      }
      return {
        action: record.action,
        bias: record.bias,
        confidence: record.confidence,
        narrative: record.narrative,
        disclaimer: record.disclaimer,
        suggested_entry: record.suggested_entry,
        stop_loss: record.suggested_stop_loss,
        take_profit: record.suggested_take_profit,
        expected_rr: record.expected_rr,
        invalidation_level: record.invalidation_level,
        predictions,
        key_levels: keyLevels,
      };
    };

    const result = {
      success: true,
      data: {
        prices: {
          btc: prices.btc,
          eth: prices.eth,
          marketData: prices,
          timestamp: prices.timestamp,
        },
        analysis: {
          btc: mapAnalysis(btcAnalysis),
          eth: mapAnalysis(ethAnalysis),
        },
        lastUpdated: prices.timestamp,
      },
    };

    res.json(result);
  } catch (error: any) {
    console.error('[Routes] Error fetching analysis:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch analysis' });
  }
});

/**
 * GET /api/ohlc/:coin - Get OHLC candle data for charts
 */
router.get('/ohlc/:coin', async (req: Request, res: Response) => {
  try {
    const coin = String(req.params.coin);
    const { timeframe = '15m', limit = 100 } = req.query;

    const coinMap: Record<string, string> = {
      bitcoin: 'BTC',
      btc: 'BTC',
      ethereum: 'ETH',
      eth: 'ETH',
    };
    const coinId = coinMap[coin.toLowerCase()] || coin.toUpperCase();

    // Fetch directly from Binance API
    const { fetchHistoricalCandles } = await import('../services/price-fetcher');
    const rawCandles = await fetchHistoricalCandles(coinId, String(timeframe), parseInt(String(limit), 10));

    const formatted = rawCandles.map((kline: any[]) => ({
      time: Math.floor(kline[0] / 1000),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));

    res.json({
      success: true,
      data: formatted,
      meta: { coin: coinId, timeframe, limit: parseInt(String(limit), 10), count: formatted.length },
    });
  } catch (error: any) {
    console.error('[Routes] Error fetching OHLC:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch OHLC data' });
  }
});

/**
 * GET /api/latest-price/:coin - Get latest price for a specific coin
 */
router.get('/latest-price/:coin', async (req: Request, res: Response) => {
  try {
    const coin = (req.params.coin as string).toUpperCase();
    const price = await getLatestPrice(coin);

    if (!price) {
      res.status(404).json({ error: 'Price not found' });
      return;
    }

    res.json(price);
  } catch (error: any) {
    console.error('[Routes] Error fetching latest price:', error.message);
    res.status(500).json({ error: 'Failed to fetch latest price' });
  }
});

// ============================================================================
// Additional Endpoints from old routes.js (ported to TypeScript)
// ============================================================================

/**
 * GET /api/predictions/:coin - Get prediction history for a coin with pagination
 */
router.get('/predictions/:coin', async (req: Request, res: Response): Promise<void> => {
  const { coin } = req.params;
  const { limit = 5, page = 1, method } = req.query;

  try {
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const where: any = { coin };
    if (method) where.method_id = method as string;

    const [predictions, total] = await Promise.all([
      prisma.prediction.findMany({
        where,
        orderBy: { predicted_at: 'desc' },
        take: parseInt(limit as string),
        skip,
        include: { analysis: true }
      }),
      prisma.prediction.count({ where })
    ]);

    res.json({
      success: true,
      data: predictions,
      pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string) },
      meta: { coin, limit: parseInt(limit as string), page: parseInt(page as string), method: method || 'ict' }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/analysis/run - Manual trigger for analysis
 */
router.post('/analysis/run', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { createAnalyzer } = await import('../analyzers/analyzerFactory.js');
    const { getMethodConfig } = await import('../config/methods.js');
    const { cache } = await import('../cache.js');

    console.log('[Routes] Manual analysis trigger requested');

    const priceData: any = await fetchRealTimePrices();

    const methodConfig = getMethodConfig('kim_nghia');
    const analyzer: any = createAnalyzer(methodConfig);
    const analysis = await analyzer.analyze(priceData, true);
    
    // Cache results
    const cachedData = {
      prices: priceData,
      analysis: analysis,
      lastUpdated: priceData.timestamp
    };
    cache.set(cachedData);
    
    // Save to database using Prisma
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
          raw_answer: analysis.raw_answer
        }
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
          raw_answer: analysis.raw_answer
        }
      });
    }
    
    res.json({
      success: true,
      data: cachedData,
      message: 'Analysis completed successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pending-orders - Get all pending orders
 */
router.get('/pending-orders', async (req: Request, res: Response): Promise<void> => {
  const { symbol, status, method } = req.query;
  const where: any = {};
  
  if (symbol) where.symbol = symbol;
  if (status) where.status = status;
  if (method) where.method_id = method;
  
  try {
    const orders = await prisma.pendingOrder.findMany({
      where,
      orderBy: { created_at: 'desc' }
    });
    
    res.json({
      success: true,
      data: orders,
      meta: { count: orders.length, filters: { symbol, status, method }, method: method || 'ict' }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pending-orders/:id - Get specific pending order
 */
router.get('/pending-orders/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const orderId = Array.isArray(id) ? id[0] : id;
  
  try {
    const order = await prisma.pendingOrder.findUnique({
      where: { id: parseInt(orderId) }
    });
    
    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Pending order not found'
      });
      return;
    }
    
    res.json({
      success: true,
      data: order
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/pending-orders/:id/cancel - Cancel a pending order
 */
router.post('/pending-orders/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const orderId = Array.isArray(id) ? id[0] : id;
  const { reason = 'manual' } = req.body;
  
  try {
    const order = await prisma.pendingOrder.findUnique({
      where: { id: parseInt(orderId) }
    });
    
    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Pending order not found or already executed'
      });
      return;
    }

    await prisma.pendingOrder.update({
      where: { id: parseInt(orderId) },
      data: {
        status: 'cancelled',
        close_reason: reason
      }
    });
    
    res.json({
      success: true,
      message: 'Pending order cancelled successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// Mount Sub-routers (JavaScript modules)
// ============================================================================

/**
 * Mount accounts router
 * Endpoints: GET /api/accounts, GET /api/accounts/:symbol, POST /api/accounts/reset/:symbol
 */
router.use('/accounts', accountsRouter);

/**
 * Mount positions router
 * Endpoints: GET /api/positions, GET /api/positions/:id, POST /api/positions/open, POST /api/positions/close/:id
 */
router.use('/positions', positionsRouter);

/**
 * Mount performance router
 * Endpoints: GET /api/performance, GET /api/performance/equity-curve, GET /api/performance/trades, etc.
 */
router.use('/performance', performanceRouter);

/**
 * Mount testnet router
 * Endpoints: GET /api/testnet/accounts, GET /api/testnet/positions, etc.
 */
router.use('/testnet', testnetRouter);

export default router;
