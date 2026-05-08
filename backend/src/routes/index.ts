import { Router, Request, Response, NextFunction } from 'express';
import { getRecentAnalysis } from '../repositories/analysis.repository';
import { getLatestPrice } from '../repositories/market.repository';
import { fetchRealTimePrices } from '../services/price-fetcher';
import { prisma } from '../lib/prisma';

// Import JavaScript sub-routers
import accountsRouter from './accounts.js';
import positionsRouter from './positions.js';
import performanceRouter from './performance.js';
import testnetRouter from './testnet.js';

const router = Router();

// Middleware to inject Prisma client into routes for JavaScript sub-routers
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
 * GET /api/analysis - Get recent analysis
 */
router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const coin = (req.query.coin as string) || 'BTC';
    const limit = parseInt(req.query.limit as string) || 10;
    const methodId = req.query.methodId as string;

    const result = await getRecentAnalysis(coin, limit, methodId);
    res.json(result);
  } catch (error: any) {
    console.error('[Routes] Error fetching analysis:', error.message);
    res.status(500).json({ error: 'Failed to fetch analysis' });
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
    const { fetchPrices } = await import('../price-fetcher.js');
    const { createAnalyzer } = await import('../analyzers/analyzerFactory.js');
    const { getMethodConfig } = await import('../config/methods.js');
    const { cache } = await import('../cache.js');

    console.log('[Routes] Manual analysis trigger requested');

    // Fetch prices
    const priceData: any = await fetchPrices();

    // Run analysis (use Kim Nghia method for manual trigger)
    const methodConfig = getMethodConfig('kim_nghia');
    const analyzer: any = createAnalyzer(methodConfig);
    const analysis = await analyzer.analyze(priceData, prisma);
    
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
