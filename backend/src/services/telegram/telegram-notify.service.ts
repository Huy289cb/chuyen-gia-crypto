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
  const title = mapTradeEventType(eventType);
  if (!title) return;

  const d = eventData || {};
  notifyTrade(
    {
      title,
      symbol: String(d.symbol ?? d.coin ?? ''),
      side: d.side != null ? String(d.side) : undefined,
      entry: typeof d.entry_price === 'number' ? d.entry_price : typeof d.entry === 'number' ? d.entry : undefined,
      stopLoss: typeof d.stop_loss === 'number' ? d.stop_loss : undefined,
      takeProfit: typeof d.take_profit === 'number' ? d.take_profit : undefined,
      pnl: typeof d.realized_pnl === 'number' ? d.realized_pnl : typeof d.pnl === 'number' ? d.pnl : undefined,
      reason: d.close_reason != null ? String(d.close_reason) : d.reason != null ? String(d.reason) : undefined,
      extra: {
        position_id: positionId,
        order_id: d.order_id != null ? String(d.order_id) : undefined,
      },
    },
    `event:${eventType}:${positionId}:${d.binance_order_id ?? ''}`
  );
}
