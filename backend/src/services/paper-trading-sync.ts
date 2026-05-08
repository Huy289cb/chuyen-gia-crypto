import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import {
  closePosition,
  createPosition,
  executePendingOrder,
  getPendingOrders,
  getPositions,
  recordTradeEvent,
  updateAccountBalance,
  updatePosition,
} from '../repositories/paperTrading.repository';

export interface RealtimeCandle {
  price: number;
  high: number;
  low: number;
}

function isLong(side: string): boolean {
  return side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
}

function shouldTriggerPendingOrder(
  side: string,
  entryPrice: number,
  currentPrice: number,
  candle: RealtimeCandle
): boolean {
  if (isLong(side)) {
    return candle.low <= entryPrice || currentPrice <= entryPrice;
  }

  return candle.high >= entryPrice || currentPrice >= entryPrice;
}

function calculatePnl(side: string, entryPrice: number, closePrice: number, sizeQty: number): number {
  const raw = (closePrice - entryPrice) * sizeQty;
  return isLong(side) ? raw : -raw;
}

async function executeTriggeredPendingOrders(symbol: string, candle: RealtimeCandle): Promise<void> {
  const pendingOrders = await getPendingOrders({ symbol, status: 'pending' });
  for (const order of pendingOrders) {
    const triggered = shouldTriggerPendingOrder(order.side, order.entry_price, candle.price, candle);
    if (!triggered) {
      continue;
    }

    const positionId = randomUUID();
    const createdPosition = await createPosition({
      positionId,
      accountId: order.account_id,
      symbol,
      side: order.side,
      entryPrice: order.entry_price,
      stopLoss: order.stop_loss,
      takeProfit: order.take_profit,
      sizeUsd: order.size_usd,
      sizeQty: order.size_qty,
      riskUsd: order.risk_usd,
      riskPercent: order.risk_percent,
      expectedRr: order.expected_rr,
      linkedPredictionId: order.linked_prediction_id ?? undefined,
      invalidationLevel: order.invalidation_level ?? undefined,
      tpLevels: undefined,
      tpHitCount: 0,
      partialClosed: 0,
    });

    await executePendingOrder(order.order_id, positionId);
    await recordTradeEvent(createdPosition.id, 'pending_order_executed', {
      order_id: order.order_id,
      entry_price: order.entry_price,
    });
  }
}

async function syncOpenPositions(symbol: string, candle: RealtimeCandle): Promise<void> {
  const openPositions = await getPositions({ symbol, status: 'open' });
  for (const position of openPositions) {
    const unrealizedPnl = calculatePnl(position.side, position.entry_price, candle.price, position.size_qty);
    const rrDenominator = position.risk_usd || 1;

    await updatePosition(position.position_id, {
      current_price: candle.price,
      unrealized_pnl: unrealizedPnl,
      r_multiple: unrealizedPnl / rrDenominator,
    });

    const slHit = isLong(position.side) ? candle.low <= position.stop_loss : candle.high >= position.stop_loss;
    const tpHit = isLong(position.side) ? candle.high >= position.take_profit : candle.low <= position.take_profit;
    if (!slHit && !tpHit) {
      continue;
    }

    const closeReason = slHit ? 'stop_loss' : 'take_profit';
    const closePrice = slHit ? position.stop_loss : position.take_profit;
    const realizedPnl = calculatePnl(position.side, position.entry_price, closePrice, position.size_qty);

    await closePosition(position.position_id, closePrice, closeReason);
    await updatePosition(position.position_id, {
      realized_pnl: realizedPnl,
      unrealized_pnl: 0,
      current_price: closePrice,
      r_multiple: realizedPnl / rrDenominator,
      tp_hit_count: tpHit ? 1 : 0,
    });

    const account = await prisma.account.findUnique({ where: { id: position.account_id } });
    if (account) {
      const newBalance = account.current_balance + realizedPnl;
      await updateAccountBalance(account.id, newBalance, realizedPnl);

      const isWin = realizedPnl > 0;
      await prisma.account.update({
        where: { id: account.id },
        data: {
          total_trades: { increment: 1 },
          winning_trades: { increment: isWin ? 1 : 0 },
          losing_trades: { increment: isWin ? 0 : 1 },
          consecutive_losses: isWin ? 0 : { increment: 1 },
          last_trade_time: new Date(),
          updated_at: new Date(),
        },
      });
    }

    await recordTradeEvent(position.id, 'position_closed', {
      reason: closeReason,
      close_price: closePrice,
      realized_pnl: realizedPnl,
    });
  }
}

export async function syncPaperTradingForSymbol(symbol: string, candle: RealtimeCandle): Promise<void> {
  await executeTriggeredPendingOrders(symbol, candle);
  await syncOpenPositions(symbol, candle);
}
