import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
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

function calculatePnl(side: string, entryPrice: number, closePrice: number, sizeQty: number): number {
  const raw = (closePrice - entryPrice) * sizeQty;
  return side === 'long' ? raw : -raw;
}

// GET /api/positions - Get positions with optional filters
router.get('/', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { symbol, status, method } = req.query;
  const where: any = {};
  
  if (symbol) where.symbol = String(Array.isArray(symbol) ? symbol[0] : symbol).toUpperCase();
  if (status) where.status = String(Array.isArray(status) ? status[0] : status);
  if (method) where.account = { method_id: String(Array.isArray(method) ? method[0] : method) };

  try {
    const positions = await prismaClient.position.findMany({
      where,
      orderBy: { entry_time: 'desc' },
      include: { account: true }
    });
    
    return res.json({
      success: true,
      data: positions,
      meta: { 
        count: positions.length, 
        filters: { 
          symbol: Array.isArray(symbol) ? symbol[0] : symbol, 
          status: Array.isArray(status) ? status[0] : status, 
          method: Array.isArray(method) ? method[0] : method 
        }, 
        method: (Array.isArray(method) ? method[0] : method) || 'ict' 
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/positions/:id - Get position by ID
router.get('/:id', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { id } = req.params;

  try {
    const position = await prismaClient.position.findUnique({
      where: { position_id: String(id) },
      include: { account: true }
    });
    
    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }
    
    return res.json({
      success: true,
      data: position
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/positions/open - Open a new position
router.post('/open', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
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
    // @ts-ignore - JS module, will be migrated later
    const { AUTO_ENTRY_CONFIG } = await import('../services/autoEntryLogic.js');
    const { getMethodConfig } = await import('../config/methods.js');
    const normalizedSymbol = String(symbol).toUpperCase();
    const methodId = method_id || 'ict';

    const account = await prismaClient.account.upsert({
      where: {
        symbol_method_id: {
          symbol: normalizedSymbol,
          method_id: methodId,
        },
      },
      update: {},
      create: {
        symbol: normalizedSymbol,
        method_id: methodId,
        starting_balance: 100,
        current_balance: 100,
        equity: 100,
      },
    });
    
    const openPositions = await prismaClient.position.findMany({
      where: {
        symbol: normalizedSymbol,
        status: 'open',
        account: { method_id: methodId },
      },
    });

    if (openPositions.length >= AUTO_ENTRY_CONFIG.maxPositionsPerSymbol) {
      return res.status(400).json({
        success: false,
        error: `Maximum positions (${AUTO_ENTRY_CONFIG.maxPositionsPerSymbol}) already open for this symbol`
      });
    }
    
    const riskAmount = account.current_balance * 0.01;
    const riskDistance = Math.abs(entry_price - stop_loss);
    
    let minSLDistancePercent = 0.005;
    const currentMethodId = methodId;
    
    try {
      const methodConfig = getMethodConfig(currentMethodId);
      minSLDistancePercent = methodConfig.autoEntry?.minSLDistancePercent || 0.005;
    } catch (error: any) {
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

    const position = await prismaClient.position.create({
      data: {
        position_id: randomUUID(),
        account_id: account.id,
        symbol: normalizedSymbol,
        side,
        entry_price,
        current_price: entry_price,
        stop_loss,
        take_profit,
        size_usd: size_usd || actualSizeUsd,
        size_qty: sizeQty,
        risk_usd: riskAmount,
        risk_percent: 1,
        expected_rr: expectedRR,
        unrealized_pnl: 0,
        realized_pnl: 0,
        r_multiple: expectedRR,
      },
      include: {
        account: true,
      },
    });

    await prismaClient.tradeEvent.create({
      data: {
        position_id: position.id,
        event_type: 'position_opened',
        event_data: JSON.stringify({
          method_id: methodId,
          suggestion,
        }),
      },
    });
    
    return res.json({
      success: true,
      data: position,
      message: 'Position opened successfully'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/positions/close/:id - Close a position
router.post('/close/:id', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { id } = req.params;
  const { reason = 'manual', current_price } = req.body;
  const closeReason = Array.isArray(reason) ? reason[0] : String(reason);

  try {
    const { fetchRealTimePrices } = await import('../services/price-fetcher');
    const position = await prismaClient.position.findUnique({
      where: { position_id: String(id) },
      include: { account: true },
    }) as any;
    
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
    
    let currentPrice = current_price;
    if (!currentPrice) {
      try {
        const priceData: any = await fetchRealTimePrices();
        currentPrice = priceData[position.symbol.toLowerCase()]?.price || position.entry_price;
      } catch (error: any) {
        console.error('[Routes] Error fetching real-time price, using entry_price:', error.message);
        currentPrice = position.entry_price;
      }
    }

    const realizedPnl = calculatePnl(position.side, position.entry_price, currentPrice, position.size_qty);
    const isWin = realizedPnl > 0;
    const updatedPosition = await prismaClient.position.update({
      where: { position_id: String(id) },
      data: {
        status: 'closed',
        close_price: currentPrice,
        close_time: new Date(),
        close_reason: closeReason,
        current_price: currentPrice,
        realized_pnl: realizedPnl,
        unrealized_pnl: 0,
        r_multiple: position.risk_usd ? realizedPnl / position.risk_usd : 0,
      },
    });

    await prismaClient.account.update({
      where: { id: position.account_id },
      data: {
        current_balance: position.account.current_balance + realizedPnl,
        equity: position.account.current_balance + realizedPnl,
        unrealized_pnl: 0,
        realized_pnl: { increment: realizedPnl },
        total_trades: { increment: 1 },
        winning_trades: { increment: isWin ? 1 : 0 },
        losing_trades: { increment: isWin ? 0 : 1 },
        consecutive_losses: isWin ? 0 : { increment: 1 },
        last_trade_time: new Date(),
        updated_at: new Date(),
      },
    });

    await prismaClient.tradeEvent.create({
      data: {
        position_id: position.id,
        event_type: 'position_closed',
        event_data: JSON.stringify({
          closeReason,
          close_price: currentPrice,
          realized_pnl: realizedPnl,
        }),
      },
    });
    
    return res.json({
      success: true,
      data: updatedPosition,
      realized_pnl: realizedPnl,
      is_win: isWin,
      message: 'Position closed successfully'
    });
  } catch (error: any) {
    console.error('[Routes] Close position error:', error);
    console.error('[Routes] Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// GET /api/positions/:id/predictions - Get predictions for a position with pagination
router.get('/:id/predictions', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;

  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available'
    });
  }

  const { id } = req.params;
  const { limit = 5, page = 1 } = req.query;
  const limitNum = parseInt(String(Array.isArray(limit) ? limit[0] : limit));
  const pageNum = parseInt(String(Array.isArray(page) ? page[0] : page));

  try {
    const skip = (pageNum - 1) * limitNum;
    
    const [predictions, total] = await Promise.all([
      prismaClient.prediction.findMany({
        where: { linked_position_id: parseInt(String(id)) },
        orderBy: { predicted_at: 'desc' },
        take: limitNum,
        skip,
        include: { analysis: true }
      }),
      prismaClient.prediction.count({ where: { linked_position_id: parseInt(String(id)) } })
    ]);
    
    return res.json({
      success: true,
      data: predictions,
      meta: { total, page: pageNum, limit: limitNum }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
