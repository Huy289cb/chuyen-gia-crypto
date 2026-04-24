/**
 * Testnet Routes
 * 
 * API endpoints for Binance Futures Testnet integration
 * including accounts, positions, performance, and manual sync
 */

import express from 'express';

const router = express.Router();

/**
 * GET /api/testnet/accounts - List testnet accounts
 */
router.get('/accounts', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  try {
    const { getTestnetAccount } = await import('../db/testnetDatabase.js');
    
    // Get BTC Kim Nghia account (testnet only supports BTC)
    const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Testnet account not found'
      });
    }
    
    res.json({
      success: true,
      data: [account],
      meta: { count: 1 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/testnet/positions - List testnet positions
 */
router.get('/positions', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { status, account_id } = req.query;
  const filters = {};
  
  if (status) filters.status = status;
  if (account_id) filters.account_id = account_id;
  
  try {
    const { getTestnetPositions } = await import('../db/testnetDatabase.js');
    const positions = await getTestnetPositions(db, filters);
    
    res.json({
      success: true,
      data: positions,
      meta: { count: positions.length, filters }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/testnet/positions/:id - Get position detail
 */
router.get('/positions/:id', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { id } = req.params;
  
  try {
    const { getTestnetPosition, getTestnetTradeEvents } = await import('../db/testnetDatabase.js');
    const position = await getTestnetPosition(db, id);
    
    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }
    
    // Get trade events for this position
    const events = await getTestnetTradeEvents(db, id);
    
    res.json({
      success: true,
      data: {
        ...position,
        events
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/testnet/performance/:accountId - Performance metrics
 */
router.get('/performance/:accountId', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { accountId } = req.params;
  
  try {
    const { getTestnetPerformanceMetrics } = await import('../db/testnetDatabase.js');
    const metrics = await getTestnetPerformanceMetrics(db, accountId);
    
    if (!metrics) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/testnet/equity-curve/:accountId - Equity curve data
 */
router.get('/equity-curve/:accountId', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { accountId } = req.params;
  const { limit = 100 } = req.query;
  
  try {
    const { getTestnetAccountSnapshots } = await import('../db/testnetDatabase.js');
    const snapshots = await getTestnetAccountSnapshots(db, accountId, parseInt(limit));
    
    res.json({
      success: true,
      data: snapshots,
      meta: { count: snapshots.length, limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/testnet/trades/:accountId - Trade history
 */
router.get('/trades/:accountId', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { accountId } = req.params;
  const { limit = 50 } = req.query;
  
  try {
    const { getTestnetPositions } = await import('../db/testnetDatabase.js');
    const positions = await getTestnetPositions(db, { account_id: accountId, status: 'closed' }, parseInt(limit));
    
    res.json({
      success: true,
      data: positions,
      meta: { count: positions.length, limit: parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/testnet/reset/:accountId - Reset account
 */
router.post('/reset/:accountId', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { accountId } = req.params;
  
  try {
    const { resetTestnetAccount } = await import('../db/testnetDatabase.js');
    await resetTestnetAccount(db, accountId);
    
    res.json({
      success: true,
      message: 'Testnet account reset successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/testnet/sync/:accountId - Manual sync with Binance
 */
router.get('/sync/:accountId', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { accountId } = req.params;
  
  try {
    const { getTestnetAccount } = await import('../db/testnetDatabase.js');
    const { syncTestnetAccount } = await import('../services/testnetEngine.js');
    
    const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Testnet account not found'
      });
    }
    
    // Perform manual sync
    const balance = await syncTestnetAccount(db, account);
    
    res.json({
      success: true,
      message: 'Testnet account synced successfully',
      data: {
        balance: balance.availableBalance,
        equity: balance.totalWalletBalance,
        unrealized_pnl: balance.totalUnrealizedProfit,
        synced_at: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/testnet/positions/:id/close - Close a testnet position manually
 */
router.post('/positions/:id/close', async (req, res) => {
  const { db, dbEnabled } = req;
  
  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }
  
  const { id } = req.params;
  const { reason = 'manual' } = req.body;
  
  try {
    const { getTestnetPosition } = await import('../db/testnetDatabase.js');
    const { closeTestnetPositionEngine } = await import('../services/testnetEngine.js');
    const { fetchRealTimePrices } = await import('../price-fetcher.js');
    
    // Get position
    const position = await getTestnetPosition(db, id);
    
    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }
    
    if (position.status !== 'open') {
      return res.status(400).json({
        success: false,
        error: 'Position is already closed'
      });
    }
    
    // Fetch current price
    const priceData = await fetchRealTimePrices(db);
    const currentPrice = priceData.btc?.price || priceData.eth?.price;
    
    if (!currentPrice) {
      return res.status(503).json({
        success: false,
        error: 'Unable to fetch current price'
      });
    }
    
    // Close position
    const result = await closeTestnetPositionEngine(db, position, currentPrice, reason);
    
    res.json({
      success: true,
      message: 'Position closed successfully',
      data: {
        position_id: id,
        close_price: currentPrice,
        realized_pnl: result.realizedPnl,
        is_win: result.isWin,
        close_reason: reason
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
