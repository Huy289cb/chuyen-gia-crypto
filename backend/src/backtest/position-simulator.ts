import type { BacktestCandle, BacktestTrade } from './types';
import type { TradeSide } from './signal-direction';

export interface OpenSimPosition {
  id: number;
  side: TradeSide;
  timeframe: string;
  playbookKey: string | null;
  grade: string;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  slDistancePct: number;
  rr: number;
  notionalUsd: number;
  feePctPerSide: number;
  entryBarIndex: number;
}

export function checkBarForExit(
  pos: OpenSimPosition,
  bar: BacktestCandle
): { closePrice: number; closeReason: 'stop_loss' | 'take_profit' } | null {
  const isLong = pos.side === 'long';
  const slHit = isLong ? bar.low <= pos.stopLoss : bar.high >= pos.stopLoss;
  const tpHit = isLong ? bar.high >= pos.takeProfit : bar.low <= pos.takeProfit;

  if (slHit && tpHit) {
    return { closePrice: pos.stopLoss, closeReason: 'stop_loss' };
  }
  if (slHit) {
    return { closePrice: pos.stopLoss, closeReason: 'stop_loss' };
  }
  if (tpHit) {
    return { closePrice: pos.takeProfit, closeReason: 'take_profit' };
  }
  return null;
}

export function closePositionAt(
  pos: OpenSimPosition,
  closeTime: number,
  closePrice: number,
  closeReason: BacktestTrade['closeReason'],
  barsHeld: number
): Omit<BacktestTrade, 'id'> {
  const qty = pos.notionalUsd / pos.entryPrice;
  const raw = (closePrice - pos.entryPrice) * qty;
  const pnlUsd = pos.side === 'long' ? raw : -raw;
  const feeUsd = pos.notionalUsd * pos.feePctPerSide * 2;
  const netPnl = pnlUsd - feeUsd;
  const pnlPct = (netPnl / pos.notionalUsd) * 100;

  return {
    side: pos.side,
    timeframe: pos.timeframe,
    playbookKey: pos.playbookKey,
    grade: pos.grade,
    entryTime: pos.entryTime,
    entryPrice: pos.entryPrice,
    stopLoss: pos.stopLoss,
    takeProfit: pos.takeProfit,
    slDistancePct: pos.slDistancePct,
    rr: pos.rr,
    closeTime,
    closePrice,
    closeReason,
    pnlUsd: netPnl,
    pnlPct,
    barsHeld,
  };
}

/** Scan forward from fromBarIndex for SL/TP (end-of-run flush). */
export function simulatePositionExit(
  pos: OpenSimPosition,
  bars: BacktestCandle[],
  fromBarIndex: number
): Omit<BacktestTrade, 'id'> | null {
  for (let i = fromBarIndex; i < bars.length; i++) {
    const hit = checkBarForExit(pos, bars[i]);
    if (hit) {
      return closePositionAt(pos, bars[i].timestamp, hit.closePrice, hit.closeReason, i - pos.entryBarIndex);
    }
  }
  const last = bars[bars.length - 1];
  if (!last || last.timestamp <= pos.entryTime) return null;
  return closePositionAt(pos, last.timestamp, last.close, 'end_of_data', bars.length - 1 - pos.entryBarIndex);
}
