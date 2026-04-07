import express from 'express';
import { cache } from './cache.js';
import positionsRouter from './routes/positions.js';
import accountsRouter from './routes/accounts.js';
import performanceRouter from './routes/performance.js';

const router = express.Router();
let db = null;
let dbEnabled = false;

// Initialize database connection (optional)
export async function initDb() {
  try {
    const { initDatabase } = await import('./db/database.js');
    const { runMigrations } = await import('./db/migrations.js');
    db = await initDatabase();
    await runMigrations(db);
    dbEnabled = true;
    console.log('[Routes] Database connected and migrations run');
  } catch (error) {
    console.log('[Routes] Database not available:', error.message);
    db = null;
    dbEnabled = false;
  }
  return { db, dbEnabled };
}

// Middleware to inject db into routes
router.use((req, res, next) => {
  req.db = db;
  req.dbEnabled = dbEnabled;
  next();
});

// GET /api/analysis - Get cached trend analysis
router.get('/analysis', (req, res) => {
  const cached = cache.get();
  
  if (!cached) {
    return res.status(503).json({
      success: false,
      error: 'Data not available yet',
      message: 'Analysis is running. Please try again in a few moments.',
      status: 'initializing'
    });
  }
  
  res.json({
    success: true,
    data: cached.data,
    meta: {
      cachedAt: cached.cachedAt,
      ageSeconds: cached.age,
      nextUpdateIn: Math.max(0, 900 - cached.age) // seconds until next update (15 min = 900s)
    }
  });
});

// GET /api/predictions/:coin - Get prediction history for a coin
router.get('/predictions/:coin', async (req, res) => {
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available',
      message: 'Please install sqlite3: npm install sqlite3'
    });
  }
  
  const { coin } = req.params;
  const { limit = 50 } = req.query;
  
  try {
    const { getRecentAnalysisWithPredictions } = await import('./db/database.js');
    const history = await getRecentAnalysisWithPredictions(db, coin, parseInt(limit));
    res.json({
      success: true,
      data: history,
      meta: { coin, limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Aggregate candles into higher timeframes
function aggregateOHLC(candles, targetTimeframe) {
  if (!candles || candles.length === 0) return [];
  if (targetTimeframe === '15m') return candles;
  
  const minutesPerCandle = {
    '1h': 60,
    '4h': 240,
    '1d': 1440
  };
  
  const minutes = minutesPerCandle[targetTimeframe];
  if (!minutes) return candles;
  
  // Group candles by time window
  const groups = new Map();
  
  candles.forEach(c => {
    const time = c.time || Math.floor(new Date(c.timestamp).getTime() / 1000);
    // Group by timeframe window (240min for 4h, 1440min for 1d)
    const windowTime = Math.floor(time / (minutes * 60)) * (minutes * 60);
    
    if (!groups.has(windowTime)) {
      groups.set(windowTime, []);
    }
    groups.get(windowTime).push(c);
  });
  
  // Aggregate each group
  const aggregated = [];
  const sortedTimes = Array.from(groups.keys()).sort((a, b) => a - b);
  
  sortedTimes.forEach((time) => {
    const group = groups.get(time);
    if (!group || group.length === 0) return;
    
    // Sort group by time to ensure correct open/close order
    group.sort((a, b) => (a.time || a.timestamp) - (b.time || b.timestamp));
    
    const open = group[0].open;
    const close = group[group.length - 1].close;
    const high = Math.max(...group.map(c => c.high));
    const low = Math.min(...group.map(c => c.low));
    const volume = group.reduce((sum, c) => sum + (c.volume || 0), 0);
    
    aggregated.push({
      timestamp: new Date(time * 1000).toISOString(),
      time,
      open,
      high,
      low,
      close,
      volume
    });
  });
  
  return aggregated;
}

// GET /api/ohlc/:coin - Get OHLC candle data for charts
router.get('/ohlc/:coin', async (req, res) => {
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available',
      message: 'Please install sqlite3: npm install sqlite3'
    });
  }
  
  const { coin } = req.params;
  const { timeframe = '15m', limit = 100 } = req.query;
  
  try {
    const { getOHLCCandles } = await import('./db/database.js');
    // Map URL coin names to database coin IDs
    const coinMap = {
      'bitcoin': 'BTC',
      'btc': 'BTC',
      'ethereum': 'ETH',
      'eth': 'ETH'
    };
    const coinId = coinMap[coin.toLowerCase()] || coin.toUpperCase();
    
    // Use 15m data as base (from Binance API for detailed ICT analysis)
    const hoursBack = timeframe === '1d' ? 720 : timeframe === '4h' ? 168 : 48;
    const baseTimeframe = '15m';
    const rawCandles = await getOHLCCandles(db, coinId, hoursBack, baseTimeframe);
    
    // Format raw data
    const formatted = rawCandles.map(c => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
    
    // Aggregate if needed (for 1h, 4h, 1d)
    const aggregated = aggregateOHLC(formatted, timeframe);
    
    // Limit results
    const limited = aggregated.slice(-parseInt(limit));
    
    res.json({
      success: true,
      data: limited,
      meta: { coin, coinId, timeframe, count: limited.length, source: '15m_aggregated' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/accuracy/:coin - Get prediction accuracy stats
router.get('/accuracy/:coin', async (req, res) => {
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available',
      message: 'Please install sqlite3: npm install sqlite3'
    });
  }
  
  const { coin } = req.params;
  const { hours = 24 } = req.query;
  
  try {
    const { getPredictionAccuracy } = await import('./db/database.js');
    const stats = await getPredictionAccuracy(db, coin, parseInt(hours));
    res.json({
      success: true,
      data: stats,
      meta: { coin, hours: parseInt(hours) }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/health - Health check
router.get('/health', (req, res) => {
  const cached = cache.get();
  res.json({
    status: 'ok',
    database: db ? 'connected' : 'disconnected',
    cache: {
      hasData: !!cached,
      age: cached?.age || null,
      cachedAt: cached?.cachedAt || null
    },
    timestamp: new Date().toISOString()
  });
});

// POST /api/analysis/run - Manual trigger for analysis
router.post('/analysis/run', async (req, res) => {
  try {
    const { fetchPrices } = await import('./price-fetcher.js');
    const { analyzeWithGroq } = await import('./groqAnalyzer.js');
    const { cache } = await import('./cache.js');
    
    console.log('[Routes] Manual analysis trigger requested');
    
    // Fetch prices
    const priceData = await fetchPrices(db);
    
    // Run analysis
    const analysis = await analyzeWithGroq(priceData, db);
    
    // Cache results
    const cachedData = {
      prices: priceData,
      analysis: analysis,
      lastUpdated: priceData.timestamp
    };
    cache.set(cachedData);
    
    // Save to database if enabled
    if (dbEnabled && db) {
      const { saveAnalysis } = await import('./db/database.js');
      await saveAnalysis(db, 'BTC', priceData, analysis);
      await saveAnalysis(db, 'ETH', priceData, analysis);
    }
    
    res.json({
      success: true,
      data: cachedData,
      message: 'Analysis completed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Mount sub-routers
router.use('/positions', positionsRouter);
router.use('/accounts', accountsRouter);
router.use('/performance', performanceRouter);

export default router;
export { db, dbEnabled };
