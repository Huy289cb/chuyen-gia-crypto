import {
  isTelegramEnabled,
  shouldNotifyRisk,
  shouldNotifyTrades,
  shouldNotifyVerbose,
} from '../../config/telegram';
import { enqueueTelegramMessage } from './telegram-client';
import { formatAlert, formatTradeNotify, mapTradeEventType } from './message-formatters';
import type { TradeNotifyPayload } from './message-formatters';

const dedupCache = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;
const VERBOSE_DEBOUNCE_MS = 5 * 60_000;

let realtimeMuted = false;

export function setTelegramRealtimeMuted(muted: boolean): void {
  realtimeMuted = muted;
}

export function isTelegramRealtimeMuted(): boolean {
  return realtimeMuted;
}

function shouldDedup(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const prev = dedupCache.get(key);
  if (prev != null && now - prev < ttlMs) return true;
  dedupCache.set(key, now);
  if (dedupCache.size > 500) {
    for (const [k, t] of dedupCache) {
      if (now - t > ttlMs) dedupCache.delete(k);
    }
  }
  return false;
}

export function notifyTrade(payload: TradeNotifyPayload, dedupKey?: string): void {
  if (!isTelegramEnabled() || realtimeMuted || !shouldNotifyTrades()) return;
  const key = dedupKey || `trade:${payload.title}:${payload.symbol}:${payload.reason}`;
  if (shouldDedup(key, DEDUP_TTL_MS)) return;
  enqueueTelegramMessage(formatTradeNotify(payload));
}

export function notifyAlert(title: string, body: string, dedupKey?: string, debounceMs = DEDUP_TTL_MS): void {
  if (!isTelegramEnabled() || realtimeMuted) return;
  if (!shouldNotifyRisk() && !shouldNotifyVerbose()) return;
  const key = dedupKey || `alert:${title}:${body.slice(0, 80)}`;
  if (shouldDedup(key, debounceMs)) return;
  enqueueTelegramMessage(formatAlert(title, body));
}

export function notifyVerbose(title: string, body: string, dedupKey?: string): void {
  if (!isTelegramEnabled() || realtimeMuted || !shouldNotifyVerbose()) return;
  const key = dedupKey || `verbose:${title}:${body.slice(0, 80)}`;
  if (shouldDedup(key, VERBOSE_DEBOUNCE_MS)) return;
  enqueueTelegramMessage(formatAlert(title, body));
}

export function notifyFromTradeEvent(
  eventType: string,
  eventData: Record<string, unknown> | null | undefined,
  positionId?: string
): void {
  if (eventData?.reconciliation_backfill === true) {
    return;
  }

  const d = eventData || {};

  // Partial fills are internal progress — user only needs the final open notification.
  if (eventType === 'partial_fill') {
    return;
  }

  // Bookkeeping / reconciliation closes (PnL=0, no wallet change) are pure
  // internal DB sync — nothing the user needs to act on, so stay silent.
  if (d.suppress_telegram === true) {
    return;
  }

  if (eventType === 'protective_failed' && d.action === 'market_close') {
    // position_closed event follows successful emergency close — avoid duplicate Telegram.
    return;
  }

  const title = mapTradeEventType(eventType);
  if (!title) return;

  const entry =
    typeof d.entry_price === 'number'
      ? d.entry_price
      : typeof d.entry === 'number'
        ? d.entry
        : typeof d.avg_price === 'number'
          ? d.avg_price
          : undefined;
  const sizeQty =
    typeof d.size_qty === 'number'
      ? d.size_qty
      : typeof d.executed_qty === 'number'
        ? d.executed_qty
        : undefined;
  notifyTrade(
    {
      title,
      symbol: d.symbol != null ? String(d.symbol) : d.coin != null ? String(d.coin) : undefined,
      side: d.side != null ? String(d.side) : undefined,
      entry,
      closePrice: typeof d.close_price === 'number' ? d.close_price : undefined,
      stopLoss: typeof d.stop_loss === 'number' ? d.stop_loss : undefined,
      takeProfit: typeof d.take_profit === 'number' ? d.take_profit : undefined,
      sizeQty,
      sizeUsd: typeof d.size_usd === 'number' ? d.size_usd : undefined,
      pnl:
        typeof d.realized_pnl === 'number'
          ? d.realized_pnl
          : typeof d.pnl === 'number'
            ? d.pnl
            : undefined,
      accountBalance:
        typeof d.account_balance === 'number'
          ? d.account_balance
          : typeof d.current_balance === 'number'
            ? d.current_balance
            : undefined,
      accountEquity:
        typeof d.account_equity === 'number'
          ? d.account_equity
          : typeof d.equity === 'number'
            ? d.equity
            : undefined,
      reason:
        d.close_reason != null
          ? String(d.close_reason)
          : d.reason != null
            ? String(d.reason)
            : undefined,
      extra: {
        position_id: positionId,
        order_id: d.order_id != null ? String(d.order_id) : undefined,
      },
    },
    `event:${eventType}:${positionId}:${d.binance_order_id ?? ''}`
  );
}
