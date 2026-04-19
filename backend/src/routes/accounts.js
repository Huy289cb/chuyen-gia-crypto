import express from 'express';

const router = express.Router();

// GET /api/accounts - Get all accounts (or filter by method)
router.get('/', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { method } = req.query;

  try {
    let accounts;
    if (method) {
      const { getAccountsByMethod } = await import('../db/database.js');
      accounts = await getAccountsByMethod(db, method);
    } else {
      const { getAllAccounts } = await import('../db/database.js');
      accounts = await getAllAccounts(db);
    }
    
    res.json({
      success: true,
      data: accounts,
      meta: { count: accounts.length, method: method || null }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/accounts/:symbol - Get account by symbol (and optionally method)
router.get('/:symbol', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol } = req.params;
  const { method } = req.query;

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
    
    res.json({
      success: true,
      data: account,
      meta: { method: method || null }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/accounts/reset/:symbol - Reset account to starting balance (and optionally method)
router.post('/reset/:symbol', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol } = req.params;
  const { method = 'ict' } = req.body;

  try {
    const { resetAccount } = await import('../db/database.js');
    const changes = await resetAccount(db, symbol, method);
    
    if (!changes) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { getAccountBySymbolAndMethod } = await import('../db/database.js');
    const account = await getAccountBySymbolAndMethod(db, symbol, method);
    
    res.json({
      success: true,
      data: account,
      meta: { method },
      message: 'Account reset successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
