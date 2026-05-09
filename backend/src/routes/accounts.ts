import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// Extend Express Request to include prisma
declare global {
  namespace Express {
    interface Request {
      prisma?: typeof prisma;
    }
  }
}

// GET /api/accounts - Get all accounts (or filter by method)
router.get('/', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { method } = req.query;

  try {
    let accounts;
    if (method) {
      accounts = await prismaClient.account.findMany({
        where: { method_id: String(method) },
        orderBy: { created_at: 'desc' }
      });
    } else {
      accounts = await prismaClient.account.findMany({
        orderBy: { created_at: 'desc' }
      });
    }
    
    return res.json({
      success: true,
      data: accounts,
      meta: { count: accounts.length, method: method || null }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/accounts/:symbol - Get account by symbol (and optionally method)
router.get('/:symbol', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
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
      account = await prismaClient.account.findUnique({
        where: { symbol_method_id: { symbol: String(symbol).toUpperCase(), method_id: String(method) } }
      });
    } else {
      account = await prismaClient.account.findFirst({
        where: { symbol: String(symbol).toUpperCase() }
      });
    }
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    return res.json({
      success: true,
      data: account,
      meta: { method: method || null }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/accounts/reset/:symbol - Reset account to starting balance (and optionally method)
router.post('/reset/:symbol', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol } = req.params;
  const { method = 'ict' } = req.body;

  try {
    const account = await prismaClient.account.findUnique({
      where: { symbol_method_id: { symbol: String(symbol).toUpperCase(), method_id: String(method) } }
    });
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }
    
    const updatedAccount = await prismaClient.account.update({
      where: { symbol_method_id: { symbol: String(symbol).toUpperCase(), method_id: String(method) } },
      data: {
        current_balance: account.starting_balance,
        equity: account.starting_balance,
        unrealized_pnl: 0,
        realized_pnl: 0,
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        max_drawdown: 0,
        consecutive_losses: 0,
        last_trade_time: null,
        cooldown_until: null
      }
    });
    
    return res.json({
      success: true,
      data: updatedAccount,
      meta: { method },
      message: 'Account reset successfully'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
