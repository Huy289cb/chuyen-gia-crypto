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
  recommended_action: 'hold' | 'reduce' | 'exit';
  reason: string;
}

/**
 * Analyze position health
 */
export function analyzePositionHealth(position: PositionData): PositionHealthResult {
  const { entry_price, current_price, stop_loss, take_profit, entry_time, side } = position;

  // Calculate PnL percentage
  let pnlPercent = 0;
  if (side === 'long') {
    pnlPercent = ((current_price - entry_price) / entry_price) * 100;
  } else {
    pnlPercent = ((entry_price - current_price) / entry_price) * 100;
  }

  // Calculate time in position
  const timeInPositionMinutes = (Date.now() - entry_time.getTime()) / (1000 * 60);

  // Calculate distance to SL and TP
  let distanceToSlPercent = 0;
  let distanceToTpPercent = 0;

  if (side === 'long') {
    distanceToSlPercent = ((current_price - stop_loss) / entry_price) * 100;
    distanceToTpPercent = ((take_profit - current_price) / entry_price) * 100;
  } else {
    distanceToSlPercent = ((stop_loss - current_price) / entry_price) * 100;
    distanceToTpPercent = ((current_price - take_profit) / entry_price) * 100;
  }

  // Determine health and recommended action
  let health: 'healthy' | 'warning' | 'critical' = 'healthy';
  let recommendedAction: 'hold' | 'reduce' | 'exit' = 'hold';
  let reason = 'Position is healthy';

  // Critical conditions
  if (distanceToSlPercent < 0.2) {
    health = 'critical';
    recommendedAction = 'exit';
    reason = 'Position near stop loss - exit immediately';
  } else if (pnlPercent < -0.8) {
    health = 'critical';
    recommendedAction = 'exit';
    reason = 'Large loss - exit to prevent further damage';
  }

  // Warning conditions
  if (health === 'healthy') {
    if (distanceToSlPercent < 0.5) {
      health = 'warning';
      recommendedAction = 'reduce';
      reason = 'Position approaching stop loss - consider reducing size';
    } else if (pnlPercent < -0.4) {
      health = 'warning';
      recommendedAction = 'reduce';
      reason = 'Moderate loss - consider reducing exposure';
    } else if (pnlPercent > 1.0 && timeInPositionMinutes > 60) {
      health = 'healthy';
      recommendedAction = 'reduce';
      reason = 'Position in profit for extended time - take partial profit';
    } else if (pnlPercent < -0.2 && timeInPositionMinutes > 120) {
      health = 'warning';
      recommendedAction = 'exit';
      reason = 'Position losing for extended time - exit to cut losses';
    }
  }

  return {
    health,
    pnl_percent: pnlPercent,
    time_in_position_minutes: timeInPositionMinutes,
    distance_to_sl_percent: distanceToSlPercent,
    distance_to_tp_percent: distanceToTpPercent,
    recommended_action: recommendedAction,
    reason
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
