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

  const { symbol, method } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    let account;
    if (method) {
      const { getAccountBySymbolAndMethod } = await import('../db/database.js');
      account = await getAccountBySymbolAndMethod(db, symbol, method);
    } else {
      const { getAccountBySymbol } = await import('../db/database.js');
      account = await getAccountBySymbol(db, symbol);
    }
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { calculatePerformance } = await import('../db/database.js');
    const performance = await calculatePerformance(db, account.id);
    
    res.json({
      success: true,
      data: performance,
      meta: { symbol, account_id: account.id, method: method || null }
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

  const { symbol, hours = 168, method } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    let account;
    if (method) {
      const { getAccountBySymbolAndMethod } = await import('../db/database.js');
      account = await getAccountBySymbolAndMethod(db, symbol, method);
    } else {
      const { getAccountBySymbol } = await import('../db/database.js');
      account = await getAccountBySymbol(db, symbol);
    }
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { getAccountSnapshots } = await import('../db/database.js');
    const snapshots = await getAccountSnapshots(db, account.id, parseInt(hours));
    
    res.json({
      success: true,
      data: snapshots,
      meta: { symbol, hours: parseInt(hours), count: snapshots.length, method: method || null }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/performance/trades - Get trade history with pagination
router.get('/trades', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, limit = 10, page = 1, outcome, method } = req.query;

  try {
    const { getPositions } = await import('../db/database.js');
    const filters = { status: ['closed', 'stopped', 'taken_profit', 'closed_manual', 'prediction_reversal'] };
    
    if (symbol) {
      filters.symbol = symbol;
    }
    
    if (outcome) {
      filters.outcome = outcome;
    }
    
    if (method) {
      filters.method_id = method;
    }
    
    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const offset = (pageNum - 1) * limitNum;
    
    // Use server-side pagination
    const result = await getPositions(db, filters, { limit: limitNum, offset });
    
    res.json({
      success: true,
      data: result.data,
      meta: { 
        total: result.pagination.total,
        page: pageNum,
        totalPages: result.pagination.totalPages,
        limit: limitNum,
        symbol,
        outcome: outcome || 'all',
        method: method || null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/performance/accuracy-timeframe - Get accuracy by timeframe
router.get('/accuracy-timeframe', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, method } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    let account;
    if (method) {
      const { getAccountBySymbolAndMethod } = await import('../db/database.js');
      account = await getAccountBySymbolAndMethod(db, symbol, method);
    } else {
      const { getAccountBySymbol } = await import('../db/database.js');
      account = await getAccountBySymbol(db, symbol);
    }
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { calculateAccuracyByTimeframe } = await import('../db/database.js');
    const accuracy = await calculateAccuracyByTimeframe(db, account.id);
    
    res.json({
      success: true,
      data: accuracy,
      meta: { symbol, account_id: account.id, method: method || null }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/performance/accuracy-bias - Get accuracy by bias
router.get('/accuracy-bias', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, method } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    let account;
    if (method) {
      const { getAccountBySymbolAndMethod } = await import('../db/database.js');
      account = await getAccountBySymbolAndMethod(db, symbol, method);
    } else {
      const { getAccountBySymbol } = await import('../db/database.js');
      account = await getAccountBySymbol(db, symbol);
    }
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { calculateAccuracyByBias } = await import('../db/database.js');
    const accuracy = await calculateAccuracyByBias(db, account.id);
    
    res.json({
      success: true,
      data: accuracy,
      meta: { symbol, account_id: account.id, method: method || null }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/performance/hold-time - Get average hold time
router.get('/hold-time', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, method } = req.query;

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required'
    });
  }

  try {
    let account;
    if (method) {
      const { getAccountBySymbolAndMethod } = await import('../db/database.js');
      account = await getAccountBySymbolAndMethod(db, symbol, method);
    } else {
      const { getAccountBySymbol } = await import('../db/database.js');
      account = await getAccountBySymbol(db, symbol);
    }
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { calculateAverageHoldTime } = await import('../db/database.js');
    const holdTime = await calculateAverageHoldTime(db, account.id);
    
    res.json({
      success: true,
      data: holdTime,
      meta: { symbol, account_id: account.id, method: method || null }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
