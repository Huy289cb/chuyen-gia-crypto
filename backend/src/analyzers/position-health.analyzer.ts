/**
 * Position Health Analyzer
 * Analyzes open positions to determine health status
 * Used by position monitor to decide on HOLD / REDUCE / EXIT actions
 */

export interface PositionData {
  position_id: string;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  entry_time: Date;
  size_qty: number;
  unrealized_pnl: number;
}

export interface PositionHealthResult {
  health: 'healthy' | 'warning' | 'critical';
  pnl_percent: number;
  time_in_position_minutes: number;
  distance_to_sl_percent: number;
  distance_to_tp_percent: number;
  /** 0 = at entry, 1 = at SL (fraction of entry→SL range consumed). */
  sl_progress: number | null;
  recommended_action: 'hold' | 'reduce' | 'exit';
  reason: string;
}

export interface PositionHealthOptions {
  /** Cumulative fraction already closed by monitor (0–1). Blocks repeat REDUCE. */
  partial_closed?: number;
}

/** Fraction of entry→SL distance consumed (0 at entry, 1 at SL). */
export function computeSlProgress(position: PositionData): number | null {
  const { entry_price, current_price, stop_loss, side } = position;
  if (side === 'long') {
    const range = entry_price - stop_loss;
    if (range <= 0) return null;
    return Math.max(0, Math.min(1, (entry_price - current_price) / range));
  }
  const range = stop_loss - entry_price;
  if (range <= 0) return null;
  return Math.max(0, Math.min(1, (current_price - entry_price) / range));
}

/**
 * Analyze position health
 */
export function analyzePositionHealth(
  position: PositionData,
  options?: PositionHealthOptions
): PositionHealthResult {
  const { entry_price, current_price, stop_loss, take_profit, entry_time, side } = position;
  const partialClosed = options?.partial_closed ?? 0;
  const alreadyReduced = partialClosed >= 0.45;

  // Calculate PnL percentage
  let pnlPercent = 0;
  if (side === 'long') {
    pnlPercent = ((current_price - entry_price) / entry_price) * 100;
  } else {
    pnlPercent = ((entry_price - current_price) / entry_price) * 100;
  }

  // Calculate time in position
  const timeInPositionMinutes = (Date.now() - entry_time.getTime()) / (1000 * 60);

  const slProgress = computeSlProgress(position);

  // Display metrics (% of entry — informational only)
  let distanceToSlPercent = 0;
  let distanceToTpPercent = 0;

  if (side === 'long') {
    distanceToSlPercent = ((current_price - stop_loss) / entry_price) * 100;
    distanceToTpPercent = ((take_profit - current_price) / entry_price) * 100;
  } else {
    distanceToSlPercent = ((stop_loss - current_price) / entry_price) * 100;
    distanceToTpPercent = ((current_price - take_profit) / entry_price) * 100;
  }

  let health: 'healthy' | 'warning' | 'critical' = 'healthy';
  let recommendedAction: 'hold' | 'reduce' | 'exit' = 'hold';
  let reason = 'Position is healthy';

  if (slProgress != null && slProgress >= 0.9) {
    health = 'critical';
    recommendedAction = 'exit';
    reason = 'Price within 10% of stop-loss range — full exit';
  } else if (pnlPercent < -0.8) {
    health = 'critical';
    recommendedAction = 'exit';
    reason = 'Large loss - exit to prevent further damage';
  } else if (!alreadyReduced && slProgress != null && slProgress >= 0.75) {
    health = 'warning';
    recommendedAction = 'reduce';
    reason = 'Traveled 75%+ toward stop loss — one-time 50% reduce';
  } else if (!alreadyReduced && pnlPercent > 1.0 && timeInPositionMinutes > 60) {
    health = 'healthy';
    recommendedAction = 'reduce';
    reason = 'Position in profit for extended time — one-time partial take-profit';
  } else if (pnlPercent < -0.5 && timeInPositionMinutes > 120) {
    health = 'warning';
    recommendedAction = 'exit';
    reason = 'Position losing for extended time';
  }

  return {
    health,
    pnl_percent: pnlPercent,
    time_in_position_minutes: timeInPositionMinutes,
    distance_to_sl_percent: distanceToSlPercent,
    distance_to_tp_percent: distanceToTpPercent,
    sl_progress: slProgress,
    recommended_action: recommendedAction,
    reason,
  };
}

/**
 * Check if position should be reversed
 * Only reverse if new valid setup exists (to be called from LLM dispatch)
 */
export function shouldReversePosition(
  position: PositionData,
  newSetupBias: 'bullish' | 'bearish' | 'neutral'
): boolean {
  // Only reverse if:
  // 1. Position is losing
  // 2. New setup is strongly opposite
  // 3. Time in position is significant

  const health = analyzePositionHealth(position);
  
  if (health.recommended_action !== 'exit') {
    return false;
  }

  if (newSetupBias === 'neutral') {
    return false;
  }

  if (position.side === 'long' && newSetupBias === 'bearish') {
    return true;
  }

  if (position.side === 'short' && newSetupBias === 'bullish') {
    return true;
  }

  return false;
}
