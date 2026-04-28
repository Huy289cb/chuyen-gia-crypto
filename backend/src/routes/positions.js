import express from 'express';

const router = express.Router();

// GET /api/positions - Get positions with optional filters
router.get('/', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, status, method } = req.query;
  const filters = {};
  
  if (symbol) filters.symbol = symbol;
  if (status) filters.status = status;
  if (method) filters.method_id = method;

  try {
    const { getPositions } = await import('../db/database.js');
    const positions = await getPositions(db, filters);
    
    res.json({
      success: true,
      data: positions,
      meta: { count: positions.length, filters, method: method || 'ict' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/positions/:id - Get position by ID
router.get('/:id', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { id } = req.params;

  try {
    const { getPosition } = await import('../db/database.js');
    const position = await getPosition(db, id);
    
    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }
    
    res.json({
      success: true,
      data: position
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/positions/open - Open a new position
router.post('/open', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, side, entry_price, stop_loss, take_profit, size_usd, method_id } = req.body;

  if (!symbol || !side || !entry_price || !stop_loss || !take_profit) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: symbol, side, entry_price, stop_loss, take_profit'
    });
  }

  if (!['long', 'short'].includes(side)) {
    return res.status(400).json({
      success: false,
      error: 'Side must be "long" or "short"'
    });
  }

  try {
    const { getOrCreateAccount } = await import('../db/database.js');
    const { evaluateAutoEntry } = await import('../services/autoEntryLogic.js');
    const { openPosition } = await import('../services/paperTradingEngine.js');
    const { getPositions } = await import('../db/database.js');
    const { AUTO_ENTRY_CONFIG } = await import('../services/autoEntryLogic.js');
    const { getMethodConfig } = await import('../config/methods.js');
    
    // Get account
    const account = await getOrCreateAccount(db, symbol, method_id || 'ict', 100);
    
    // Check if already has too many open positions (respect maxPositionsPerSymbol limit)
    const openPositions = await getPositions(db, { symbol, status: 'open' });
    if (openPositions.length >= AUTO_ENTRY_CONFIG.maxPositionsPerSymbol) {
      return res.status(400).json({
        success: false,
        error: `Maximum positions (${AUTO_ENTRY_CONFIG.maxPositionsPerSymbol}) already open for this symbol`
      });
    }
    
    // Calculate position parameters
    const riskAmount = account.current_balance * 0.01; // 1% risk
    const riskDistance = Math.abs(entry_price - stop_loss);
    
    // Validate minimum risk distance using method-specific threshold
    let minSLDistancePercent = 0.005; // Default 0.5%
    const currentMethodId = method_id || 'ict';
    
    try {
      const methodConfig = getMethodConfig(currentMethodId);
      minSLDistancePercent = methodConfig.autoEntry?.minSLDistancePercent || 0.005;
    } catch (error) {
      console.warn(`[Routes] Failed to get method config for ${currentMethodId}, using default 0.5%:`, error.message);
    }
    
    const minRiskDistance = entry_price * minSLDistancePercent;
    if (riskDistance <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid risk distance (entry equals stop loss)'
      });
    }
    if (riskDistance < minRiskDistance) {
      return res.status(400).json({
        success: false,
        error: `Risk distance too small: ${riskDistance.toFixed(2)} (minimum ${minRiskDistance.toFixed(2)}, ${(minSLDistancePercent * 100).toFixed(1)}% of entry for ${currentMethodId})`
      });
    }
    
    const sizeQty = riskDistance > 0 ? riskAmount / riskDistance : 0;
    const actualSizeUsd = sizeQty * entry_price;
    const rewardDistance = Math.abs(take_profit - entry_price);
    const expectedRR = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    
    const suggestion = {
      side,
      entry_price,
      stop_loss,
      take_profit,
      size_usd: actualSizeUsd,
      size_qty: sizeQty,
      risk_usd: riskAmount,
      risk_percent: 1,
      expected_rr: expectedRR,
      r_multiple: expectedRR
    };
    
    const position = await openPosition(db, account, suggestion);
    
    res.json({
      success: true,
      data: position,
      message: 'Position opened successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/positions/close/:id - Close a position
router.post('/close/:id', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { id } = req.params;
  const { reason = 'manual', current_price } = req.body;

  try {
    const { getPosition } = await import('../db/database.js');
    const { closePosition: closePos } = await import('../services/paperTradingEngine.js');
    const { fetchRealTimePrices } = await import('../price-fetcher.js');
    
    const position = await getPosition(db, id);
    
    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }
    
    if (position.status !== 'open') {
      return res.status(400).json({
        success: false,
        error: 'Position is not open'
      });
    }
    
    // Use provided price or fetch real-time price from Binance
    let currentPrice = current_price;
    if (!currentPrice) {
      try {
        const priceData = await fetchRealTimePrices();
        currentPrice = priceData[position.symbol.toLowerCase()]?.price || position.entry_price;
      } catch (error) {
        console.error('[Routes] Error fetching real-time price, using entry_price:', error.message);
        currentPrice = position.entry_price;
      }
    }
    
    const result = await closePos(db, position, currentPrice, reason);
    
    res.json({
      success: true,
      data: result.closedPosition,
      realized_pnl: result.realizedPnl,
      is_win: result.isWin,
      message: 'Position closed successfully'
    });
  } catch (error) {
    console.error('[Routes] Close position error:', error);
    console.error('[Routes] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// GET /api/positions/:id/predictions - Get predictions for a position with pagination
router.get('/:id/predictions', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { id } = req.params;
  const { limit = 5, page = 1 } = req.query;

  try {
    const { getPredictionsByPositionId } = await import('../db/database.js');
    const result = await getPredictionsByPositionId(db, id, parseInt(limit), parseInt(page));
    
    res.json({
      success: true,
      data: result.data,
      meta: result.pagination
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
