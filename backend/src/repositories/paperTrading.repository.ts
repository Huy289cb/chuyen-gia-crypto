import { prisma } from '../lib/prisma';

/**
 * Paper Trading Repository
 * 
 * Handles all database operations for paper trading accounts, positions, and orders
 */

export interface AccountData {
  symbol: string;
  methodId: string;
  startingBalance?: number;
  currentBalance?: number;
  equity?: number;
}

export interface PositionData {
  positionId: string;
  accountId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  sizeQty: number;
  riskUsd: number;
  riskPercent: number;
  expectedRr: number;
  linkedPredictionId?: number;
  invalidationLevel?: number;
  tpLevels?: string;
  tpHitCount?: number;
  partialClosed?: number;
}

export interface PendingOrderData {
  orderId: string;
  accountId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  sizeQty: number;
  riskUsd: number;
  riskPercent: number;
  expectedRr: number;
  linkedPredictionId?: number;
  invalidationLevel?: number;
  methodId?: string;
}

/**
 * Get or create paper trading account
 */
export async function getOrCreateAccount(
  symbol: string,
  methodId: string,
  startingBalance = 100
): Promise<any> {
  const account = await prisma.account.findUnique({
    where: {
      symbol_method_id: {
        symbol: symbol.toUpperCase(),
        method_id: methodId,
      },
    },
  });

  if (account) {
    return account;
  }

  return prisma.account.create({
    data: {
      symbol: symbol.toUpperCase(),
      method_id: methodId,
      starting_balance: startingBalance,
      current_balance: startingBalance,
      equity: startingBalance,
    },
  });
}

/**
 * Get account by symbol and method
 */
export async function getAccount(symbol: string, methodId: string): Promise<any | null> {
  return prisma.account.findUnique({
    where: {
      symbol_method_id: {
        symbol: symbol.toUpperCase(),
        method_id: methodId,
      },
    },
  });
}

/**
 * Update account balance
 */
export async function updateAccountBalance(
  accountId: number,
  newBalance: number,
  pnl = 0
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: {
      current_balance: newBalance,
      equity: newBalance,
      realized_pnl: { increment: pnl },
      updated_at: new Date(),
    },
  });
}

/**
 * Update account equity
 */
export async function updateAccountEquity(
  accountId: number,
  unrealizedPnl: number
): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');

  await prisma.account.update({
    where: { id: accountId },
    data: {
      unrealized_pnl: unrealizedPnl,
      equity: account.current_balance + unrealizedPnl,
      updated_at: new Date(),
    },
  });
}

/**
 * Create position
 */
export async function createPosition(data: PositionData): Promise<any> {
  return prisma.position.create({
    data: {
      position_id: data.positionId,
      account_id: data.accountId,
      symbol: data.symbol.toUpperCase(),
      side: data.side,
      entry_price: data.entryPrice,
      stop_loss: data.stopLoss,
      take_profit: data.takeProfit,
      size_usd: data.sizeUsd,
      size_qty: data.sizeQty,
      risk_usd: data.riskUsd,
      risk_percent: data.riskPercent,
      expected_rr: data.expectedRr,
      linked_prediction_id: data.linkedPredictionId,
      invalidation_level: data.invalidationLevel,
      tp_levels: data.tpLevels,
      tp_hit_count: data.tpHitCount || 0,
      partial_closed: data.partialClosed || 0,
    },
  });
}

/**
 * Get positions with filters
 */
export async function getPositions(filters: {
  accountId?: number;
  symbol?: string;
  status?: string;
  limit?: number;
}): Promise<any[]> {
  const where: any = {};

  if (filters.accountId) where.account_id = filters.accountId;
  if (filters.symbol) where.symbol = filters.symbol.toUpperCase();
  if (filters.status) where.status = filters.status;

  return prisma.position.findMany({
    where,
    orderBy: { entry_time: 'desc' },
    take: filters.limit,
  });
}

/**
 * Get single position by ID
 */
export async function getPosition(positionId: string): Promise<any | null> {
  return prisma.position.findUnique({
    where: { position_id: positionId },
  });
}

/**
 * Update position
 */
export async function updatePosition(
  positionId: string,
  updates: Partial<any>
): Promise<void> {
  await prisma.position.update({
    where: { position_id: positionId },
    data: updates,
  });
}

/**
 * Close position
 */
export async function closePosition(
  positionId: string,
  closePrice: number,
  closeReason: string
): Promise<void> {
  await prisma.position.update({
    where: { position_id: positionId },
    data: {
      status: 'closed',
      close_price: closePrice,
      close_time: new Date(),
      close_reason: closeReason,
    },
  });
}

/**
 * Create pending order
 */
export async function createPendingOrder(data: PendingOrderData): Promise<any> {
  return prisma.pendingOrder.create({
    data: {
      order_id: data.orderId,
      account_id: data.accountId,
      symbol: data.symbol.toUpperCase(),
      side: data.side,
      entry_price: data.entryPrice,
      stop_loss: data.stopLoss,
      take_profit: data.takeProfit,
      size_usd: data.sizeUsd,
      size_qty: data.sizeQty,
      risk_usd: data.riskUsd,
      risk_percent: data.riskPercent,
      expected_rr: data.expectedRr,
      linked_prediction_id: data.linkedPredictionId,
      invalidation_level: data.invalidationLevel,
      method_id: data.methodId || 'ict',
      status: 'pending',
      created_at: new Date(),
    },
  });
}

/**
 * Get pending orders with filters
 */
export async function getPendingOrders(filters: {
  accountId?: number;
  symbol?: string;
  status?: string;
  methodId?: string;
}): Promise<any[]> {
  const where: any = {};

  if (filters.accountId) where.account_id = filters.accountId;
  if (filters.symbol) where.symbol = filters.symbol.toUpperCase();
  if (filters.status) where.status = filters.status;
  if (filters.methodId) where.method_id = filters.methodId;

  return prisma.pendingOrder.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Execute pending order
 */
export async function executePendingOrder(
  orderId: string,
  _positionId: string
): Promise<void> {
  await prisma.pendingOrder.update({
    where: { order_id: orderId },
    data: {
      status: 'executed',
      executed_at: new Date(),
    },
  });
}

/**
 * Cancel pending order
 */
export async function cancelPendingOrder(orderId: string, reason = 'cancelled'): Promise<void> {
  await prisma.pendingOrder.update({
    where: { order_id: orderId },
    data: {
      status: `cancelled_${reason}`,
    },
  });
}

/**
 * Update pending order
 */
export async function updatePendingOrder(
  orderId: string,
  updates: Partial<any>
): Promise<void> {
  await prisma.pendingOrder.update({
    where: { order_id: orderId },
    data: updates,
  });
}

/**
 * Create account snapshot
 */
export async function createAccountSnapshot(accountId: number): Promise<number> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  const openPositions = await prisma.position.count({
    where: { account_id: accountId, status: 'open' },
  });

  const snapshot = await prisma.accountSnapshot.create({
    data: {
      account_id: accountId,
      balance: account.current_balance,
      equity: account.equity,
      unrealized_pnl: account.unrealized_pnl,
      open_positions: openPositions,
      timestamp: new Date(),
    },
  });

  return snapshot.id;
}

/**
 * Get account snapshots
 */
export async function getAccountSnapshots(accountId: number, limit = 100): Promise<any[]> {
  return prisma.accountSnapshot.findMany({
    where: { account_id: accountId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

/**
 * Record trade event
 */
export async function recordTradeEvent(
  positionId: number,
  eventType: string,
  eventData?: any
): Promise<number> {
  const event = await prisma.tradeEvent.create({
    data: {
      position_id: positionId,
      event_type: eventType,
      event_data: eventData ? JSON.stringify(eventData) : null,
      timestamp: new Date(),
    },
  });

  return event.id;
}

/**
 * Reset account
 */
export async function resetAccount(accountId: number): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  await prisma.account.update({
    where: { id: accountId },
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
      cooldown_until: null,
      updated_at: new Date(),
    },
  });
}
