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

  const { symbol, status } = req.query;
  const filters = {};
  
  if (symbol) filters.symbol = symbol;
  if (status) filters.status = status;

  try {
    const { getPositions } = await import('../db/database.js');
    const positions = await getPositions(db, filters);
    
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

  const { symbol, side, entry_price, stop_loss, take_profit, size_usd } = req.body;

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
    
    // Get account
    const account = await getOrCreateAccount(db, symbol, 100);
    
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
    
    // Validate minimum risk distance (0.5% of entry price to prevent tight stop losses)
    const minRiskDistance = entry_price * 0.005; // 0.5% minimum
    if (riskDistance <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid risk distance (entry equals stop loss)'
      });
    }
    if (riskDistance < minRiskDistance) {
      return res.status(400).json({
        success: false,
        error: `Risk distance too small: ${riskDistance.toFixed(2)} (minimum ${minRiskDistance.toFixed(2)}, 0.5% of entry)`
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
      expected_rr: expectedRR
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

export default router;
