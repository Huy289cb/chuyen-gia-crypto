import { notifyTrade, notifyVerbose, notifyAlert } from './telegram-notify.service';

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

export function hookTradeRejected(symbol: string, reason: string): void {
  notifyAlert('⛔ Từ chối mở lệnh', `${symbol}: ${reason}`, `reject:${symbol}:${reason.slice(0, 40)}`);
}

export function hookSignalGatePass(symbol: string, timeframe: string, grade: string): void {
  notifyVerbose(
    '✅ Signal gate PASS',
    `${symbol} ${timeframe} grade=${grade}`,
    `sg_pass:${symbol}:${timeframe}`
  );
}

export function hookSignalGateBlock(symbol: string, timeframe: string, reason: string): void {
  notifyVerbose(
    '🚫 Signal gate BLOCK',
    `${symbol} ${timeframe}: ${reason}`,
    `sg_block:${symbol}:${timeframe}:${reason.slice(0, 30)}`
  );
}

/** One message per market-scan cycle (all timeframes). */
export function hookSignalGateScanSummary(symbol: string, body: string, allBlocked: boolean): void {
  const slot = Math.floor(Date.now() / (5 * 60 * 1000));
  notifyVerbose(
    allBlocked ? '🚫 Signal Gate BLOCK — quét xong' : '✅ Signal Gate — quét xong',
    body,
    `sg_scan:${symbol}:${slot}`
  );
}

export function hookLlmNoTrade(symbol: string, reason: string): void {
  notifyVerbose('🤖 LLM no_trade', `${symbol}: ${reason}`, `llm_no:${symbol}:${reason.slice(0, 40)}`);
}

export function hookLlmExecuteFail(symbol: string, reason: string): void {
  notifyAlert('❌ Execute thất bại', `${symbol}: ${reason}`, `exec_fail:${symbol}:${reason.slice(0, 40)}`);
}

export function hookPositionMonitorAction(
  symbol: string,
  action: string,
  reason: string
): void {
  notifyAlert(`📊 Monitor: ${action}`, `${symbol}: ${reason}`, `mon:${symbol}:${action}`);
}

export function hookBinanceWsStatus(status: string, detail?: string): void {
  notifyVerbose(
    '🔌 Binance WS',
    detail ? `${status}: ${detail}` : status,
    `ws:${status}:${detail?.slice(0, 30)}`
  );
}

export function hookSchedulerStale(name: string): void {
  notifyVerbose('⏱ Scheduler stale', name, `stale:${name}`);
}

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
