import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  // Filter out undefined, null, and non-string values to prevent tailwind-merge errors
  const filtered = inputs.filter((input): input is string => 
    typeof input === 'string' && input.length > 0
  );
  return twMerge(clsx(filtered));
}

export function formatPrice(price: number | null | undefined, decimals: number = 2): string {
  if (price == null || typeof price !== 'number' || isNaN(price) || !isFinite(price)) {
    return '-';
  }
  try {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return price.toFixed(decimals);
  }
}

/** BTC qty — always show positive size; sign is conveyed by side chip. */
export function formatPositionSize(quantity: number | null | undefined, decimals: number = 4): string {
  if (quantity == null || typeof quantity !== 'number' || isNaN(quantity)) return '-';
  return Math.abs(quantity).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCloseReason(reason: string | null | undefined): string {
  if (!reason) return '—';
  const labels: Record<string, string> = {
    binance_tp: 'Chốt lời',
    binance_sl: 'Cắt lỗ',
    binance_market: 'Đóng thị trường',
    take_profit: 'Chốt lời',
    stop_loss: 'Cắt lỗ',
    protective_failed_market_close: 'Đóng khẩn (SL/TP lỗi)',
    protective_sl_breached_market: 'Cắt lỗ khẩn',
    protective_tp_reached_market: 'Chốt lời khẩn',
    manual_close: 'Đóng tay',
    reconciliation_bookkeeping: 'Dọn sổ bot',
    reconciliation_closed_not_on_binance: 'Dọn sổ bot',
    stale_ghost_open: 'Dọn sổ bot',
    reconciliation_fill: 'Dọn sổ bot',
    llm_opposite_flip: 'Đảo chiều (LLM)',
    binance_fills: 'Đóng trên Binance',
  };
  if (labels[reason]) return labels[reason];
  if (reason.startsWith('merged_into_')) return 'Gộp trùng';
  return reason
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatPercentage(value: number | null | undefined, decimals: number = 2): string {
  if (value == null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(num: number | null | undefined): string {
  if (num == null) return '-';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toString();
}

export function getTimeSince(timestamp: string | number | undefined): { text: string; status: 'fresh' | 'stale' | 'error' | 'unknown' } {
  if (!timestamp) return { text: 'N/A', status: 'unknown' };
  
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  
  if (minutes < 1) return { text: 'Just now', status: 'fresh' };
  if (minutes < 5) return { text: `${minutes}m ago`, status: 'fresh' };
  if (minutes < 15) return { text: `${minutes}m ago`, status: 'stale' };
  if (hours < 1) return { text: `${minutes}m ago`, status: 'stale' };
  return { text: `${hours}h ago`, status: 'error' };
}

export function formatVietnamTime(timestamp: string | null | undefined): string {
  if (!timestamp) return '-';
  try {
    // SQLite datetime('now') returns UTC without timezone indicator
    // Append 'Z' to make it ISO 8601 format with UTC indicator
    const utcTimestamp = timestamp.includes('Z') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
    const date = new Date(utcTimestamp);
    return date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}
