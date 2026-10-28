import { SOURCE_UNIVERSE } from './source-momentum';

/** Phase 2 hybrid book, sized as a 100 USDT account. The PO accepted that sizing on the smaller live wallet. */
export const HYBRID_LIVE = {
  momentumNotional: 25,
  momentumSlots: 2,
  momentumStop: 0.12,
  momentumRebalanceDays: 2,
  momentumLookback: 14,
  momentumMinScore: 0.02,
  gridNotional: 15,
  gridMaxLevels: 3,
  gridStep: 0.02,
  gridTakeProfit: 0.03,
  gridLookback: 10,
  crashGate: 0.06,
  dailyLossUsd: 12,
  leverage: 10,
} as const;

export const HYBRID_SYMBOLS = SOURCE_UNIVERSE;

export interface MomentumLeg {
  symbol: string;
  entry: number;
  qty: number;
}

export interface GridLeg {
  entry: number;
  qty: number;
  tp: number;
}

export interface HybridBook {
  momentum: MomentumLeg[];
  grid: GridLeg[];
  daysSinceRebalance: number;
}

export function quantityForNotional(
  notional: number,
  price: number,
  step: string,
  minQty: string,
  minNotional: string,
): string | null {
  if (!(price > 0) || !(notional > 0)) return null;
  const decimals = step.includes('.') ? step.split('.')[1].length : 0;
  const scale = 10 ** decimals;
  const stepUnits = Math.round(Number(step) * scale);
  if (!Number.isInteger(stepUnits) || stepUnits <= 0) return null;
  const units = Math.floor(Math.floor((notional / price) * scale + 1e-6) / stepUnits) * stepUnits;
  if (units <= 0) return null;
  const qty = units / scale;
  if (qty < Number(minQty) || qty * price < Number(minNotional)) return null;
  return qty.toFixed(decimals);
}

export function selectMomentum(closes: Record<string, number[]>): string[] {
  const lookback = HYBRID_LIVE.momentumLookback;
  const ranked: { symbol: string; score: number }[] = [];
  for (const symbol of HYBRID_SYMBOLS) {
    const series = closes[symbol];
    if (!series || series.length <= lookback) continue;
    const latest = series[series.length - 1];
    const past = series[series.length - 1 - lookback];
    if (!(latest > 0) || !(past > 0)) continue;
    ranked.push({ symbol, score: (latest - past) / past });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.filter((row) => row.score > HYBRID_LIVE.momentumMinScore).slice(0, HYBRID_LIVE.momentumSlots).map((row) => row.symbol);
}

export function momentumStops(book: HybridBook, marks: Record<string, number>): string[] {
  return book.momentum.filter((leg) => {
    const mark = marks[leg.symbol];
    return mark > 0 && (mark - leg.entry) / leg.entry <= -HYBRID_LIVE.momentumStop;
  }).map((leg) => leg.symbol);
}

export function gridTakeProfitIndexes(book: HybridBook, btcMark: number): number[] {
  if (!(btcMark > 0)) return [];
  return book.grid.flatMap((leg, index) => (btcMark >= leg.tp ? [index] : []));
}

export function breachedDailyLoss(dayPnl: number): boolean {
  return dayPnl <= -HYBRID_LIVE.dailyLossUsd;
}

/** New BTC grid buy. `btcCloses` ends with the last closed day. */
export function nextGridBuy(book: HybridBook, btcCloses: number[]): { notional: number } | null {
  if (book.grid.length >= HYBRID_LIVE.gridMaxLevels || btcCloses.length < HYBRID_LIVE.gridLookback + 1) return null;
  const today = btcCloses[btcCloses.length - 1];
  const yesterday = btcCloses[btcCloses.length - 2];
  if (!(today > 0) || !(yesterday > 0)) return null;
  if ((today - yesterday) / yesterday < -HYBRID_LIVE.crashGate) return null;
  const window = btcCloses.slice(-1 - HYBRID_LIVE.gridLookback, -1);
  const average = window.reduce((sum, price) => sum + price, 0) / window.length;
  const level = book.grid.length + 1;
  if (today > average * (1 - level * HYBRID_LIVE.gridStep)) return null;
  return { notional: HYBRID_LIVE.gridNotional };
}
