import express from 'express';

const router = express.Router();

// GET /api/accounts - Get all accounts
router.get('/', async (req, res) => {
  const db = req.db;
  const dbEnabled = req.dbEnabled;

  if (!dbEnabled || !db) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  try {
    const { getAllAccounts } = await import('../db/database.js');
    const accounts = await getAllAccounts(db);
    
    res.json({
      success: true,
      data: accounts,
      meta: { count: accounts.length }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/accounts/:symbol - Get account by symbol
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

  try {
    const { getAccountBySymbol } = await import('../db/database.js');
    const account = await getAccountBySymbol(db, symbol);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/accounts/reset/:symbol - Reset account to starting balance
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

  try {
    const { resetAccount } = await import('../db/database.js');
    const changes = await resetAccount(db, symbol);
    
    if (changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const { getAccountBySymbol } = await import('../db/database.js');
    const account = await getAccountBySymbol(db, symbol);
    
    res.json({
      success: true,
      data: account,
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
