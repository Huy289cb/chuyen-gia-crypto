import { prisma } from '../lib/prisma';

/**
 * Testnet Repository
 * 
 * Handles all database operations for Binance Futures Testnet integration
 */

export interface TestnetAccountData {
  symbol: string;
  methodId: string;
  startingBalance: number;
}

export interface TestnetPositionData {
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
  binanceOrderId?: string;
  binanceSlOrderId?: string;
  binanceTpOrderId?: string;
  tpLevels?: string;
  tpHitCount?: number;
  partialClosed?: number;
  entryFee?: number;
}

export interface TestnetPendingOrderData {
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
  binanceOrderId?: string;
}

/**
 * Get or create testnet account
 */
export async function getOrCreateTestnetAccount(
  symbol: string,
  methodId: string,
  startingBalance = 100
): Promise<any> {
  const account = await prisma.testnetAccount.findUnique({
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

  return prisma.testnetAccount.create({
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
 * Get testnet account
 */
export async function getTestnetAccount(symbol: string, methodId: string): Promise<any | null> {
  return prisma.testnetAccount.findUnique({
    where: {
      symbol_method_id: {
        symbol: symbol.toUpperCase(),
        method_id: methodId,
      },
    },
  });
}

/**
 * Update testnet account balance
 */
export async function updateTestnetAccountBalance(
  accountId: number,
  newBalance: number,
  pnl = 0
): Promise<void> {
  await prisma.testnetAccount.update({
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
 * Update testnet account equity directly
 */
export async function updateTestnetAccountEquityDirect(
  accountId: number,
  totalWalletBalance: number
): Promise<void> {
  const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      equity: totalWalletBalance,
      unrealized_pnl: totalWalletBalance - account.current_balance,
      updated_at: new Date(),
    },
  });
}

/**
 * Update trading fees
 */
export async function updateTradingFees(accountId: number, feeAmount: number): Promise<void> {
  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      accumulated_trading_fees: { increment: feeAmount },
      updated_at: new Date(),
    },
  });
}

/**
 * Update funding fee
 */
export async function updateFundingFee(
  positionId: string,
  feeAmount: number,
  accountId?: number
): Promise<void> {
  await prisma.testnetPosition.update({
    where: { position_id: positionId },
    data: {
      funding_fee: { increment: feeAmount },
    },
  });

  if (accountId) {
    await prisma.testnetAccount.update({
      where: { id: accountId },
      data: {
        accumulated_funding_fee: { increment: feeAmount },
        updated_at: new Date(),
      },
    });
  }
}

/**
 * Update testnet account equity
 */
export async function updateTestnetAccountEquity(
  accountId: number,
  unrealizedPnl: number
): Promise<void> {
  const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Account not found');

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      unrealized_pnl: unrealizedPnl,
      equity: account.current_balance + unrealizedPnl,
      updated_at: new Date(),
    },
  });
}

/**
 * Update testnet account stats
 */
export async function updateTestnetAccountStats(
  accountId: number,
  isWin: boolean
): Promise<void> {
  const now = new Date();

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      total_trades: { increment: 1 },
      winning_trades: { increment: isWin ? 1 : 0 },
      losing_trades: { increment: isWin ? 0 : 1 },
      consecutive_losses: isWin ? 0 : { increment: 1 },
      last_trade_time: now,
      updated_at: now,
    },
  });
}

/**
 * Check if should enter cooldown
 */
export async function shouldEnterTestnetCooldown(accountId: number): Promise<{
  shouldCooldown: boolean;
  cooldownUntil?: string;
  consecutiveLosses?: number;
  reason?: string;
}> {
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    return { shouldCooldown: false, reason: 'Account not found' };
  }

  const consecutiveLosses = account.consecutive_losses || 0;

  if (consecutiveLosses >= 3) {
    const cooldownUntil = new Date();
    cooldownUntil.setHours(cooldownUntil.getHours() + 4);

    return {
      shouldCooldown: true,
      cooldownUntil: cooldownUntil.toISOString(),
      consecutiveLosses,
      reason: `${consecutiveLosses} consecutive losses, entering 4h cooldown`,
    };
  }

  return {
    shouldCooldown: false,
    consecutiveLosses,
    reason: `${consecutiveLosses} consecutive losses, below threshold of 3`,
  };
}

/**
 * Set cooldown timestamp
 */
export async function setTestnetAccountCooldown(
  accountId: number,
  cooldownUntil: Date
): Promise<void> {
  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      cooldown_until: cooldownUntil,
    },
  });
}

/**
 * Create testnet position
 */
export async function createTestnetPosition(data: TestnetPositionData): Promise<any> {
  return prisma.testnetPosition.create({
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
      binance_order_id: data.binanceOrderId,
      binance_sl_order_id: data.binanceSlOrderId,
      binance_tp_order_id: data.binanceTpOrderId,
      tp_levels: data.tpLevels,
      tp_hit_count: data.tpHitCount || 0,
      partial_closed: data.partialClosed || 0,
      entry_fee: data.entryFee || 0,
    },
  });
}

/**
 * Get testnet positions
 */
export async function getTestnetPositions(filters: {
  accountId?: number;
  symbol?: string;
  status?: string;
  positionId?: string;
  limit?: number;
}): Promise<any[]> {
  const where: any = {};

  if (filters.accountId) where.account_id = filters.accountId;
  if (filters.symbol) where.symbol = filters.symbol.toUpperCase();
  if (filters.status) where.status = filters.status;
  if (filters.positionId) where.position_id = filters.positionId;

  return prisma.testnetPosition.findMany({
    where,
    orderBy: { entry_time: 'desc' },
    take: filters.limit,
  });
}

/**
 * Get testnet position by ID
 */
export async function getTestnetPosition(positionId: string): Promise<any | null> {
  return prisma.testnetPosition.findUnique({
    where: { position_id: positionId },
  });
}

/**
 * Update testnet position
 */
export async function updateTestnetPosition(
  positionId: string,
  updates: Partial<any>
): Promise<void> {
  await prisma.testnetPosition.update({
    where: { position_id: positionId },
    data: updates,
  });
}

/**
 * Close testnet position
 */
export async function closeTestnetPosition(
  positionId: string,
  closePrice: number,
  closeReason: string
): Promise<void> {
  await prisma.testnetPosition.update({
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
 * Record testnet trade event
 */
export async function recordTestnetTradeEvent(
  positionId: string,
  eventType: string,
  eventData?: any
): Promise<number> {
  const event = await prisma.testnetTradeEvent.create({
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
 * Get testnet trade events
 */
export async function getTestnetTradeEvents(positionId: string): Promise<any[]> {
  const events = await prisma.testnetTradeEvent.findMany({
    where: { position_id: positionId },
    orderBy: { timestamp: 'asc' },
  });

  return events.map((event) => ({
    ...event,
    event_data: event.event_data ? JSON.parse(event.event_data) : null,
  }));
}

/**
 * Create testnet account snapshot
 */
export async function createTestnetAccountSnapshot(accountId: number): Promise<number> {
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  const openPositions = await prisma.testnetPosition.count({
    where: { account_id: accountId, status: 'open' },
  });

  const snapshot = await prisma.testnetAccountSnapshot.create({
    data: {
      account_id: accountId,
      balance: account.current_balance,
      equity: account.equity,
      unrealized_pnl: account.unrealized_pnl,
      realized_pnl: account.realized_pnl,
      open_positions_count: openPositions,
      timestamp: new Date(),
    },
  });

  return snapshot.id;
}

/**
 * Get testnet account snapshots
 */
export async function getTestnetAccountSnapshots(accountId: number, limit = 100): Promise<any[]> {
  return prisma.testnetAccountSnapshot.findMany({
    where: { account_id: accountId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

/**
 * Get testnet performance metrics
 */
export async function getTestnetPerformanceMetrics(accountId: number): Promise<any> {
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) return null;

  const winRate = account.total_trades > 0
    ? (account.winning_trades / account.total_trades) * 100
    : 0;

  const avgWin = account.winning_trades > 0
    ? account.realized_pnl / account.winning_trades
    : 0;

  const profitFactor = account.losing_trades > 0 && account.realized_pnl > 0
    ? Math.abs(avgWin / (account.realized_pnl / account.losing_trades))
    : account.realized_pnl > 0 ? Infinity : 0;

  const totalReturn = ((account.current_balance - account.starting_balance) / account.starting_balance) * 100;

  return {
    ...account,
    win_rate: winRate,
    avg_win: avgWin,
    profit_factor: profitFactor,
    total_return: totalReturn,
  };
}

/**
 * Reset testnet account
 */
export async function resetTestnetAccount(accountId: number): Promise<void> {
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  await prisma.testnetAccount.update({
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

/**
 * Get testnet pending orders
 */
export async function getTestnetPendingOrders(filters: {
  orderId?: string;
  symbol?: string;
  status?: string;
  accountId?: number;
  methodId?: string;
}): Promise<any[]> {
  const where: any = {};

  if (filters.orderId) where.order_id = filters.orderId;
  if (filters.symbol) where.symbol = filters.symbol.toUpperCase();
  if (filters.status) where.status = filters.status;
  if (filters.accountId) where.account_id = filters.accountId;
  if (filters.methodId) where.method_id = filters.methodId;

  return prisma.testnetPendingOrder.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Execute testnet pending order
 */
export async function executeTestnetPendingOrder(
  orderId: string,
  _positionId: string
): Promise<void> {
  await prisma.testnetPendingOrder.update({
    where: { order_id: orderId },
    data: {
      status: 'executed',
      executed_at: new Date(),
    },
  });
}

/**
 * Cancel testnet pending order
 */
export async function cancelTestnetPendingOrder(orderId: string, reason = 'cancelled'): Promise<void> {
  await prisma.testnetPendingOrder.update({
    where: { order_id: orderId },
    data: {
      status: `cancelled_${reason}`,
    },
  });
}

/**
 * Update testnet pending order
 */
export async function updateTestnetPendingOrder(
  orderId: string,
  updates: Partial<any>
): Promise<void> {
  await prisma.testnetPendingOrder.update({
    where: { order_id: orderId },
    data: updates,
  });
}

/**
 * Create testnet pending order
 */
export async function createTestnetPendingOrder(data: TestnetPendingOrderData): Promise<any> {
  return prisma.testnetPendingOrder.create({
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
      binance_order_id: data.binanceOrderId,
    },
  });
}

/**
 * Update precision error tracking
 */
export async function updatePrecisionError(
  accountId: number,
  errorCode: string,
  errorMessage: string
): Promise<any> {
  const now = new Date();

  const account = await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      precision_error_count: { increment: 1 },
      last_precision_error_time: now,
      last_precision_error_code: errorCode,
      last_precision_error_message: errorMessage,
      updated_at: now,
    },
  });

  // Check if cooldown should be triggered
  if (account.precision_error_count >= 3) {
    const lastErrorTime = account.last_precision_error_time ? new Date(account.last_precision_error_time) : null;
    if (lastErrorTime && Date.now() - lastErrorTime.getTime() < 10 * 60 * 1000) {
      const cooldownMinutes = Math.min(5 * Math.pow(2, account.precision_error_count - 3), 30);
      const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000);

      await prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
          precision_cooldown_until: cooldownUntil,
        },
      });

      return { ...account, precision_cooldown_until: cooldownUntil };
    }
  }

  return account;
}

/**
 * Reset precision error tracking
 */
export async function resetPrecisionErrorTracking(accountId: number): Promise<any> {
  const now = new Date();

  return prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      precision_error_count: 0,
      precision_cooldown_until: null,
      last_precision_error_time: null,
      last_precision_error_code: null,
      last_precision_error_message: null,
      updated_at: now,
    },
  });
}
