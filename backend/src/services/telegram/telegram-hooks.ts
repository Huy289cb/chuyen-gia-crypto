import { notifyTrade } from './telegram-notify.service';

/** Testnet: limit pending placed (open path). */
export function hookPendingOrderPlaced(input: {
  symbol: string;
  side: string;
  timeframe: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  orderId?: string;
  binanceOrderId?: string;
}): void {
  notifyTrade(
    {
      title: '📥 Đặt lệnh chờ (limit)',
      symbol: input.symbol,
      side: input.side,
      timeframe: input.timeframe,
      entry: input.entry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      extra: {
        order_id: input.orderId,
        binance_order_id: input.binanceOrderId,
      },
    },
    `pending:${input.binanceOrderId || input.orderId}`
  );
}

/** Testnet: pending order cancelled before fill. */
export function hookPendingCancelled(symbol: string, orderId: string, reason?: string): void {
  notifyTrade(
    {
      title: '⚪ Hủy lệnh chờ',
      symbol,
      reason: reason || 'cancelled',
      extra: { order_id: orderId },
    },
    `cancel_pending:${orderId}`
  );
}
