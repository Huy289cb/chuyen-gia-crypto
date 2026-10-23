export interface SlTpLevels {
  stop_loss: number;
  take_profit: number;
}

export type ProtectiveAction =
  | 'place_sl_tp'
  | 'close_at_market_loss'
  | 'close_at_market_profit'
  | 'recompute_and_place';

export function isPastStopLoss(
  side: 'long' | 'short',
  stop_loss: number,
  mark: number
): boolean {
  if (!Number.isFinite(mark) || mark <= 0) return false;
  return side === 'long' ? mark <= stop_loss : mark >= stop_loss;
}

export function isPastTakeProfit(
  side: 'long' | 'short',
  take_profit: number,
  mark: number
): boolean {
  if (!Number.isFinite(mark) || mark <= 0) return false;
  return side === 'long' ? mark >= take_profit : mark <= take_profit;
}

export function tpInvalidForMark(side: string, take_profit: number, mark: number): boolean {
  const s = side.toLowerCase();
  if (s === 'short') return take_profit >= mark;
  return take_profit <= mark;
}

export function evaluateProtectiveAction(params: {
  side: 'long' | 'short';
  stop_loss: number;
  take_profit: number;
  mark: number;
  levels?: SlTpLevels;
}): ProtectiveAction {
  const { side, stop_loss, take_profit, mark, levels } = params;
  if (!Number.isFinite(mark) || mark <= 0) return 'place_sl_tp';

  const sl = levels?.stop_loss ?? stop_loss;
  const tp = levels?.take_profit ?? take_profit;

  if (isPastStopLoss(side, sl, mark)) return 'close_at_market_loss';
  if (isPastTakeProfit(side, tp, mark)) return 'close_at_market_profit';

  if (slTpInvalidForMark(side, sl, mark) || tpInvalidForMark(side, tp, mark)) {
    return 'recompute_and_place';
  }

  return 'place_sl_tp';
}

export function slTpInvalidForMark(
  side: string,
  stop_loss: number,
  mark: number
): boolean {
  const s = side.toLowerCase();
  if (s === 'short') return stop_loss <= mark;
  return stop_loss >= mark;
}
