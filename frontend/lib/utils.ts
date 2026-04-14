import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, decimals: number = 2): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercentage(value: number, decimals: number = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(num: number): string {
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
