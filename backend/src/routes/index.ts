import { Router, Request, Response, NextFunction } from 'express';
import { getRecentAnalysis } from '../repositories/analysis.repository';
import { getLatestPrice } from '../repositories/market.repository';
import { fetchRealTimePrices } from '../services/price-fetcher';

// Import JavaScript sub-routers
import accountsRouter from './accounts.js';
import positionsRouter from './positions.js';
import performanceRouter from './performance.js';
import testnetRouter from './testnet.js';

const router = Router();

// Initialize database connection
let db: any = null;
let dbEnabled = false;

// Local database initialization to avoid ES module compatibility issues
async function initDb() {
  try {
    // Check if sqlite3 is available
    try {
      await import('sqlite3');
      console.log('[Routes] sqlite3 module is available');
    } catch (importError: any) {
      console.error('[Routes] sqlite3 module not found:', importError.message);
      console.log('[Routes] Running without database persistence');
      db = null;
      dbEnabled = false;
      return { db, dbEnabled };
    }

    const { initDatabase } = await import('../db/database.js');
    const { runMigrations } = await import('../db/migrations.js');
    db = await initDatabase();
    await runMigrations(db);
    dbEnabled = true;
    console.log('[Routes] Database connected and migrations run');
  } catch (error: any) {
    console.error('[Routes] Database initialization failed:', error.message);
    console.error('[Routes] Error stack:', error.stack);
    console.log('[Routes] Running without database persistence');
    db = null;
    dbEnabled = false;
  }
  return { db, dbEnabled };
}

// Initialize database on startup
initDb().then(({ db: database, dbEnabled: enabled }: any) => {
  db = database;
  dbEnabled = enabled;
  console.log('[Routes] Database initialized:', dbEnabled ? 'connected' : 'disabled');
}).catch((err: Error) => {
  console.error('[Routes] Database initialization failed:', err.message);
});

// Middleware to inject db into routes for JavaScript sub-routers
router.use((req: any, _res: Response, next: NextFunction) => {
  req.db = db;
  req.dbEnabled = dbEnabled;
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
  if (!dbEnabled || !db) {
    res.status(503).json({
      success: false,
      error: 'Database not available',
      message: 'Please install sqlite3: npm install sqlite3'
    });
    return;
  }

  const { coin } = req.params;
  const { limit = 5, page = 1, method } = req.query;

  try {
    const { getRecentAnalysisWithPredictions } = await import('../db/database.js');
    const methodParam = method ? method as string : undefined;
    const result = await getRecentAnalysisWithPredictions(db, coin, parseInt(limit as string), methodParam as any, parseInt(page as string));
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
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
    const priceData: any = await fetchPrices(db);

    // Run analysis (use Kim Nghia method for manual trigger)
    const methodConfig = getMethodConfig('kim_nghia');
    const analyzer: any = createAnalyzer(methodConfig);
    const analysis = await analyzer.analyze(priceData, db);
    
    // Cache results
    const cachedData = {
      prices: priceData,
      analysis: analysis,
      lastUpdated: priceData.timestamp
    };
    cache.set(cachedData);
    
    // Save to database if enabled
    if (dbEnabled && db) {
      const { saveAnalysis } = await import('../db/database.js');
      await saveAnalysis(db, 'BTC', priceData, analysis, 'kim_nghia', analysis.raw_question, analysis.raw_answer);
      await saveAnalysis(db, 'ETH', priceData, analysis, 'kim_nghia', analysis.raw_question, analysis.raw_answer);
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
  if (!dbEnabled || !db) {
    res.status(503).json({
      success: false,
      error: 'Database not available'
    });
    return;
  }
  
  const { symbol, status, method } = req.query;
  const filters: any = {};
  
  if (symbol) filters.symbol = symbol;
  if (status) filters.status = status;
  if (method) filters.method_id = method;
  
  try {
    const { getPendingOrders } = await import('../db/database.js');
    const orders = await getPendingOrders(db, filters);
    
    res.json({
      success: true,
      data: orders,
      meta: { count: orders.length, filters, method: method || 'ict' }
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
  if (!dbEnabled || !db) {
    res.status(503).json({
      success: false,
      error: 'Database not available'
    });
    return;
  }
  
  const { id } = req.params;
  
  try {
    const { getPendingOrders } = await import('../db/database.js');
    const orders = await getPendingOrders(db, {});
    const order = orders.find((o: any) => o.id == id);
    
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
  if (!dbEnabled || !db) {
    res.status(503).json({
      success: false,
      error: 'Database not available'
    });
    return;
  }
  
  const { id } = req.params;
  const { reason = 'manual' } = req.body;
  
  try {
    const { cancelPendingOrder } = await import('../db/database.js');
    const changes = await cancelPendingOrder(db, id, reason);
    
    if (changes === 0) {
      res.status(404).json({
        success: false,
        error: 'Pending order not found or already executed'
      });
      return;
    }
    
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
