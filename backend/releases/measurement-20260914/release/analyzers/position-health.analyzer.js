"use strict";
/**
 * Position Health Analyzer
 * Analyzes open positions to determine health status
 * Used by position monitor to decide on HOLD / REDUCE / EXIT actions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeSlProgress = computeSlProgress;
exports.analyzePositionHealth = analyzePositionHealth;
exports.shouldReversePosition = shouldReversePosition;
/** Fraction of entry→SL distance consumed (0 at entry, 1 at SL). */
function computeSlProgress(position) {
    const { entry_price, current_price, stop_loss, side } = position;
    if (side === 'long') {
        const range = entry_price - stop_loss;
        if (range <= 0)
            return null;
        return Math.max(0, Math.min(1, (entry_price - current_price) / range));
    }
    const range = stop_loss - entry_price;
    if (range <= 0)
        return null;
    return Math.max(0, Math.min(1, (current_price - entry_price) / range));
}
/**
 * Analyze position health
 */
function analyzePositionHealth(position, options) {
    const { entry_price, current_price, stop_loss, take_profit, entry_time, side } = position;
    const partialClosed = options?.partial_closed ?? 0;
    const alreadyReduced = partialClosed >= 0.01;
    const exchangeSlTp = options?.exchange_sl_tp_active === true;
    const minMinutes = options?.min_minutes_before_action ?? 0;
    const minPnlPct = options?.min_pnl_percent_for_action ?? 0;
    // Calculate PnL percentage
    let pnlPercent = 0;
    if (side === 'long') {
        pnlPercent = ((current_price - entry_price) / entry_price) * 100;
    }
    else {
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
    }
    else {
        distanceToSlPercent = ((stop_loss - current_price) / entry_price) * 100;
        distanceToTpPercent = ((current_price - take_profit) / entry_price) * 100;
    }
    let health = 'healthy';
    let recommendedAction = 'hold';
    let reason = 'Position is healthy — deferring to exchange SL/TP';
    if (exchangeSlTp) {
        return {
            health,
            pnl_percent: pnlPercent,
            time_in_position_minutes: timeInPositionMinutes,
            distance_to_sl_percent: distanceToSlPercent,
            distance_to_tp_percent: distanceToTpPercent,
            sl_progress: slProgress,
            recommended_action: 'hold',
            reason,
        };
    }
    if (timeInPositionMinutes < minMinutes) {
        reason = `Hold — position age ${timeInPositionMinutes.toFixed(0)}m < min ${minMinutes}m`;
        return {
            health,
            pnl_percent: pnlPercent,
            time_in_position_minutes: timeInPositionMinutes,
            distance_to_sl_percent: distanceToSlPercent,
            distance_to_tp_percent: distanceToTpPercent,
            sl_progress: slProgress,
            recommended_action: 'hold',
            reason,
        };
    }
    reason = 'Position is healthy';
    // Critical exit only — avoid early discretionary cuts that erode R:R
    if (slProgress != null && slProgress >= 0.95) {
        health = 'critical';
        recommendedAction = 'exit';
        reason = 'SL progress >= 95% — emergency exit (exchange SL may have failed)';
    }
    else if (pnlPercent <= -1.5) {
        health = 'critical';
        recommendedAction = 'exit';
        reason = `Unrealized loss ${pnlPercent.toFixed(2)}% — emergency exit`;
    }
    else if (!alreadyReduced &&
        slProgress != null &&
        slProgress >= 0.85 &&
        pnlPercent <= -minPnlPct) {
        health = 'warning';
        recommendedAction = 'reduce';
        reason = `SL progress ${(slProgress * 100).toFixed(0)}% with loss ${pnlPercent.toFixed(2)}% — one-time 50% reduce`;
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
function shouldReversePosition(position, newSetupBias) {
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
//# sourceMappingURL=position-health.analyzer.js.map