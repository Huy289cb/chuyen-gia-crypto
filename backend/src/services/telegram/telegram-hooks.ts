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

/** Signal gate scan summary — caller should throttle to ~15m to match LLMDispatch cadence. */
export function hookSignalGateScanSummary(symbol: string, body: string, allBlocked: boolean): void {
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  notifyVerbose(
    allBlocked ? '🚫 Signal Gate BLOCK — quét (15m)' : '✅ Signal Gate — quét (15m)',
    body,
    `sg_scan:${symbol}:${slot}`
  );
}

/** One summary per LLM dispatch cycle (aligned with cron :02,:17,:32,:47). */
export function hookLlmDispatchSummary(input: {
  symbol: string;
  timeframe: string;
  decision: 'trade' | 'no_trade';
  reason: string;
  tradeSummary?: string;
  execution?: 'pending_placed' | 'exec_failed' | 'none';
  executionDetail?: string;
  orderId?: string;
  binanceOrderId?: string;
}): void {
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  const lines = [
    `${input.symbol} · ${input.timeframe}`,
    `Quyết định: ${input.decision}`,
    `Lý do: ${input.reason}`,
  ];
  if (input.tradeSummary) lines.push(input.tradeSummary);
  if (input.execution && input.execution !== 'none') {
    let execLine = `Thực thi: ${input.execution}`;
    if (input.executionDetail) execLine += ` — ${input.executionDetail}`;
    if (input.orderId) execLine += ` · order ${input.orderId}`;
    if (input.binanceOrderId) execLine += ` · Binance ${input.binanceOrderId}`;
    lines.push(execLine);
  }
  notifyVerbose('🤖 LLM Dispatch — kết quả', lines.join('\n'), `llm_sum:${input.symbol}:${slot}`);
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
