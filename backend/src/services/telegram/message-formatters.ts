import { formatVietnamTime } from '../../utils/dateHelpers';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '' : '-';
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return n.toFixed(4);
}

export function formatSideLabel(side: string | undefined): string | undefined {
  if (!side) return undefined;
  const s = side.toLowerCase();
  if (s === 'long' || s === 'buy') return 'Long';
  if (s === 'short' || s === 'sell') return 'Short';
  return side;
}

export interface TradeNotifyPayload {
  title: string;
  symbol?: string;
  side?: string;
  timeframe?: string;
  entry?: number;
  closePrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  sizeQty?: number;
  sizeUsd?: number;
  pnl?: number;
  accountBalance?: number;
  accountEquity?: number;
  reason?: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
}

export function formatTradeNotify(p: TradeNotifyPayload): string {
  const lines: string[] = [`<b>${escapeHtml(p.title)}</b>`];
  if (p.symbol) lines.push(`Symbol: <b>${escapeHtml(p.symbol)}</b>`);
  const sideLabel = formatSideLabel(p.side);
  if (sideLabel) lines.push(`Side: <b>${escapeHtml(sideLabel)}</b>`);
  if (p.timeframe) lines.push(`TF: ${escapeHtml(p.timeframe)}`);
  if (p.entry != null) lines.push(`Giá mở: ${fmtPrice(p.entry)}`);
  if (p.closePrice != null) lines.push(`Giá đóng: ${fmtPrice(p.closePrice)}`);
  if (p.stopLoss != null) lines.push(`SL: ${fmtPrice(p.stopLoss)}`);
  if (p.takeProfit != null) lines.push(`TP: ${fmtPrice(p.takeProfit)}`);
  if (p.sizeQty != null) {
    const base = p.symbol?.replace(/USDT$/i, '') ?? '';
    const vol = base
      ? `${p.sizeQty} ${base}${p.sizeUsd != null ? ` (~${fmtUsd(p.sizeUsd)})` : ''}`
      : `${p.sizeQty}${p.sizeUsd != null ? ` (~${fmtUsd(p.sizeUsd)})` : ''}`;
    lines.push(`Volume: ${vol}`);
  }
  if (p.pnl != null) {
    const sign = p.pnl >= 0 ? '+' : '';
    lines.push(`PnL: <b>${sign}${fmtUsd(p.pnl)}</b>`);
  }
  if (p.accountBalance != null) {
    lines.push(`Tài khoản: ${fmtUsd(p.accountBalance)}`);
  } else if (p.accountEquity != null) {
    lines.push(`Equity: ${fmtUsd(p.accountEquity)}`);
  }
  if (p.reason) lines.push(`Lý do: ${escapeHtml(p.reason)}`);
  if (p.extra) {
    for (const [k, v] of Object.entries(p.extra)) {
      if (v == null) continue;
      lines.push(`${escapeHtml(k)}: ${escapeHtml(String(v))}`);
    }
  }
  lines.push(`<i>${formatVietnamTime(new Date())}</i>`);
  return lines.join('\n');
}

export function formatAlert(title: string, body: string): string {
  return `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}\n<i>${formatVietnamTime(new Date())}</i>`;
}

export function mapTradeEventType(eventType: string): string | null {
  const map: Record<string, string> = {
    entry_order_filled: '🟢 Mở vị thế (fill)',
    pending_order_executed: '🟢 Mở vị thế (sim)',
    partial_fill: '🟡 Fill một phần',
    position_closed: '🔴 Đóng vị thế',
    position_closed_algo: '🔴 Đóng (SL/TP algo)',
    algo_order_filled: '⚡ Algo order filled',
    pending_order_cancelled: '⚪ Hủy lệnh chờ',
    pending_order_cancelled_ttl: '⚪ Hủy lệnh chờ (hết TTL)',
    pending_order_cancelled_drift: '⚪ Hủy lệnh chờ (lệch giá)',
  };
  return map[eventType] ?? null;
}
