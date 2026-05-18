import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import {
  closeTestnetPosition,
  createTestnetPosition,
  executeTestnetPendingOrder,
  getTestnetPendingOrders,
  getTestnetPositions,
  recordTestnetTradeEvent,
  updateTestnetAccountBalance,
  updateTestnetAccountStats,
  updateTestnetPosition,
} from '../repositories/testnet.repository';
import { calculateUnrealizedPnl, isLongSide } from './position-mark';

export interface RealtimeCandle {
  price: number;
  high: number;
  low: number;
}

function shouldTriggerPendingOrder(
  side: string,
  entryPrice: number,
  currentPrice: number,
  candle: RealtimeCandle
): boolean {
  if (isLongSide(side)) {
    return candle.low <= entryPrice || currentPrice <= entryPrice;
  }

  return candle.high >= entryPrice || currentPrice >= entryPrice;
}

async function executeTriggeredPendingOrders(symbol: string, candle: RealtimeCandle): Promise<void> {
  const pendingOrders = await getTestnetPendingOrders({ symbol, status: 'pending' });
  for (const order of pendingOrders) {
    const triggered = shouldTriggerPendingOrder(order.side, order.entry_price, candle.price, candle);
    if (!triggered) {
      continue;
    }

    const positionId = randomUUID();
    const createdPosition = await createTestnetPosition({
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
      binanceOrderId: order.binance_order_id ?? undefined,
      binanceSlOrderId: undefined,
      binanceTpOrderId: undefined,
      tpLevels: undefined,
      tpHitCount: 0,
      partialClosed: 0,
      entryFee: 0,
    });

    await executeTestnetPendingOrder(order.order_id, positionId);
    await recordTestnetTradeEvent(createdPosition.position_id, 'pending_order_executed', {
      order_id: order.order_id,
      entry_price: order.entry_price,
    });
  }
}

async function syncOpenPositions(symbol: string, candle: RealtimeCandle): Promise<void> {
  const openPositions = await getTestnetPositions({ symbol, status: 'open' });
  for (const position of openPositions) {
    const unrealizedPnl = calculateUnrealizedPnl(
      position.side,
      position.entry_price,
      candle.price,
      position.size_qty
    );
    const rrDenominator = position.risk_usd || 1;

    await updateTestnetPosition(position.position_id, {
      current_price: candle.price,
      unrealized_pnl: unrealizedPnl,
    });

    const slHit = isLongSide(position.side)
      ? candle.low <= position.stop_loss
      : candle.high >= position.stop_loss;
    const tpHit = isLongSide(position.side)
      ? candle.high >= position.take_profit
      : candle.low <= position.take_profit;
    if (!slHit && !tpHit) {
      continue;
    }

    const closeReason = slHit ? 'stop_loss' : 'take_profit';
    const closePrice = slHit ? position.stop_loss : position.take_profit;
    const realizedPnl = calculateUnrealizedPnl(
      position.side,
      position.entry_price,
      closePrice,
      position.size_qty
    );

    await closeTestnetPosition(position.position_id, closePrice, closeReason);
    await updateTestnetPosition(position.position_id, {
      realized_pnl: realizedPnl,
      unrealized_pnl: 0,
      current_price: closePrice,
      exit_fee: 0,
      funding_fee: 0,
    });

    const account = await prisma.testnetAccount.findUnique({ where: { id: position.account_id } });
    if (account) {
      const newBalance = account.current_balance + realizedPnl;
      await updateTestnetAccountBalance(account.id, newBalance, realizedPnl);
      await updateTestnetAccountStats(account.id, realizedPnl > 0);
    }

    await recordTestnetTradeEvent(position.position_id, 'position_closed', {
      reason: closeReason,
      close_price: closePrice,
      realized_pnl: realizedPnl,
      r_multiple: realizedPnl / rrDenominator,
    });
  }
}

export async function syncTestnetForSymbol(symbol: string, candle: RealtimeCandle): Promise<void> {
  // Binance handles order execution when enabled; still refresh mark/PnL on open positions.
  if (process.env.BINANCE_ENABLED !== 'true') {
    await executeTriggeredPendingOrders(symbol, candle);
  }
  await syncOpenPositions(symbol, candle);
}
