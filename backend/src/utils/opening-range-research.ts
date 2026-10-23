import type { OpportunityCandle } from './ai-opportunity';

export type OpeningRangeVariant = 'opening_range_breakout' | 'opening_range_failure';
/** Reconstruct the first raw signal, including rejected earlier opportunities, from closed history. */
export function openingRangeSignal(rows: OpportunityCandle[], asOf: number, variant: OpeningRangeVariant): 'long' | 'short' | null {
  const step = 900000, dayMs = 86400000;
  const closed = rows.filter(b => b.timestamp + step <= asOf);
  const last = closed.at(-1);
  if (!last) return null;
  const day = Math.floor(last.timestamp / dayMs) * dayMs;
  if (last.timestamp < day + 4 * step || last.timestamp >= day + 24 * step) return null;
  const start = closed.findIndex(b => b.timestamp === day);
  if (start < 20) return null;
  const relevant = closed.slice(start - 20);
  if (relevant.some((b, i) => i > 0 && b.timestamp - relevant[i - 1].timestamp !== step)) return null;
  const range = closed.slice(start, start + 4);
  const high = Math.max(...range.map(b => b.high)), low = Math.min(...range.map(b => b.low));
  const inside = (price: number) => price >= low && price <= high;
  for (let i = start + 4; i < closed.length; i++) {
    const b = closed[i];
    if (!inside(closed[i - 1].close)) continue;
    let side: 'long' | 'short' | null = null;
    if (variant === 'opening_range_breakout') {
      const mean = closed.slice(i - 20, i).reduce((sum, x) => sum + x.volume, 0) / 20;
      if (mean > 0 && b.volume >= 1.5 * mean) side = b.close > high ? 'long' : b.close < low ? 'short' : null;
    } else if (b.close > low && b.close < high && !(b.high > high && b.low < low)) {
      side = b.high > high ? 'short' : b.low < low ? 'long' : null;
    }
    if (side) return i === closed.length - 1 ? side : null;
  }
  return null;
}
