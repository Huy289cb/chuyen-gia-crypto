import express from 'express';

const router = express.Router();

// GET /api/performance - Get performance metrics for an account
router.get('/', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    const { getAccountBySymbol, calculatePerformance } = await import('../db/database.js');
    const account = await getAccountBySymbol(db, symbol);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const performance = await calculatePerformance(db, account.id);
    
    res.json({
      success: true,
      data: performance,
      meta: { symbol, account_id: account.id }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/performance/equity-curve - Get equity curve data
router.get('/equity-curve', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, hours = 168 } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    const { getAccountBySymbol, getAccountSnapshots } = await import('../db/database.js');
    const account = await getAccountBySymbol(db, symbol);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const snapshots = await getAccountSnapshots(db, account.id, parseInt(hours));
    
    res.json({
      success: true,
      data: snapshots,
      meta: { symbol, hours: parseInt(hours), count: snapshots.length }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/performance/trades - Get trade history
router.get('/trades', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, limit = 50 } = req.query;

  try {
    const { getPositions } = await import('../db/database.js');
    const filters = { status: ['closed', 'stopped', 'taken_profit', 'closed_manual'] };
    
    if (symbol) {
      filters.symbol = symbol;
    }
    
    const trades = await getPositions(db, filters);
    const limitedTrades = trades.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: limitedTrades,
      meta: { count: limitedTrades.length, symbol }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
