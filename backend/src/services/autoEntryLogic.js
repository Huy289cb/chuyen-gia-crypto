// Auto-Entry Logic for Paper Trading
// Determines when to suggest opening positions based on ICT analysis

const AUTO_ENTRY_CONFIG = {
  minConfidence: 80,           // Minimum confidence score (0-100)
  minRRRatio: 2.0,             // Minimum risk/reward ratio
  riskPerTrade: 0.01,          // 1% of account balance
  maxPositionsPerSymbol: 8,    // Max concurrent positions per symbol (BTC only) - Updated 17/04/2026
  maxConsecutiveLosses: 3,     // Trigger cooldown
  cooldownHours: 4,            // Cooldown duration in hours
  requiredTimeframes: ['1h', '4h'],  // Check these for alignment - Updated 17/04/2026 (1h primary)
  minAlignment: 0.5,           // Majority (50%+) required
  enabledSymbols: ['BTC'],     // Only enable BTC trading
  // Session timing (UTC hours)
  allowedSessions: ['london', 'ny_killzone'],
  londonSession: { start: 7, end: 10 },  // 07:00-10:00 UTC
  nyKillzone: { start: 12, end: 15 },      // 12:00-15:00 UTC
  // Partial take profits (ICT: take profits in stages)
  partialTPEnabled: true,
  partialTPRatios: [0.5, 0.5],  // 50% @ TP1, 50% @ TP2
  partialTPRRLevels: [1.0, 2.0], // TP1 @ 1:1 R:R, TP2 @ 2:1 R:R
  // Trailing stop (ICT: move SL to breakeven after TP1)
  trailingStopEnabled: true,
  trailAfterRR: 1.0,           // Start trailing after hitting 1:1 R:R
  trailDistancePct: 0.5       // 0.5% trailing distance
};

/**
 * Format date to Vietnam timezone (GMT+7)
 */
function formatVietnamTime(date) {
  return new Date(date).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Check if current time is within allowed trading sessions
 */
function isWithinAllowedSessions() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  
  const sessions = AUTO_ENTRY_CONFIG.allowedSessions;
  
  for (const session of sessions) {
    if (session === 'london') {
      const { start, end } = AUTO_ENTRY_CONFIG.londonSession;
      if (utcHour >= start && utcHour < end) return true;
    } else if (session === 'ny_killzone') {
      const { start, end } = AUTO_ENTRY_CONFIG.nyKillzone;
      if (utcHour >= start && utcHour < end) return true;
    }
  }
  
  return false;
}

/**
 * Determine if auto-entry should be suggested based on analysis
 * @param {Object} analysis - ICT analysis result
 * @param {Object} account - Account data
 * @param {Array} openPositions - Current open positions for symbol
 * @returns {Object} Entry decision with reasoning
 */
export function evaluateAutoEntry(analysis, account, openPositions = []) {
  const decision = {
    shouldEnter: false,
    action: 'no_trade',
    reason: '',
    confidence: 0,
    suggestedPosition: null
  };

  // Extract symbol from analysis or account
  const symbol = analysis.symbol || account.symbol || 'BTC';

  // Check 0: Symbol enablement (ETH trading disabled)
  if (!AUTO_ENTRY_CONFIG.enabledSymbols.includes(symbol)) {
    decision.reason = `Trading disabled for ${symbol}. Only ${AUTO_ENTRY_CONFIG.enabledSymbols.join(', ')} enabled`;
    return decision;
  }

  // Check 1: Account cooldown
  if (account.cooldown_until) {
    const cooldownEnd = new Date(account.cooldown_until);
    if (new Date() < cooldownEnd) {
      decision.reason = `Account in cooldown until ${formatVietnamTime(cooldownEnd)} (after ${account.consecutive_losses} consecutive losses)`;
      return decision;
    }
  }

  // Check 2: Trading session timing (ICT: focus on high-liquidity sessions)
  if (!isWithinAllowedSessions()) {
    decision.reason = 'Outside allowed trading sessions (London/NY killzones only)';
    return decision;
  }

  // Check 3: Max positions per symbol (5 for BTC)
  if (openPositions.length >= AUTO_ENTRY_CONFIG.maxPositionsPerSymbol) {
    decision.reason = `Maximum positions (${AUTO_ENTRY_CONFIG.maxPositionsPerSymbol}) already open for ${symbol}`;
    return decision;
  }

  // Check 4: Confidence threshold
  const confidenceScore = analysis.confidence * 100;
  if (confidenceScore < AUTO_ENTRY_CONFIG.minConfidence) {
    decision.reason = `Confidence too low (${confidenceScore.toFixed(0)}% < ${AUTO_ENTRY_CONFIG.minConfidence}%)`;
    return decision;
  }

  // Check 5: Bias must be bullish or bearish
  if (!['bullish', 'bearish'].includes(analysis.bias)) {
    decision.reason = `Bias is neutral, no clear direction`;
    return decision;
  }

  // Check 6: Multi-timeframe alignment (4h and 1d only)
  const alignment = checkTimeframeAlignment(analysis, AUTO_ENTRY_CONFIG.requiredTimeframes);
  if (alignment.alignedCount < AUTO_ENTRY_CONFIG.requiredTimeframes.length * AUTO_ENTRY_CONFIG.minAlignment) {
    decision.reason = `Multi-timeframe alignment insufficient (${alignment.alignedCount}/${AUTO_ENTRY_CONFIG.requiredTimeframes.length} aligned)`;
    return decision;
  }

  // Check 7: Expected R:R ratio from analysis
  const expectedRR = analysis.expected_rr || 2.0;
  if (expectedRR < AUTO_ENTRY_CONFIG.minRRRatio) {
    decision.reason = `Risk/Reward ratio too low (${expectedRR.toFixed(1)} < ${AUTO_ENTRY_CONFIG.minRRRatio})`;
    return decision;
  }

  // All checks passed - suggest entry
  decision.shouldEnter = true;
  decision.action = analysis.bias === 'bullish' ? 'enter_long' : 'enter_short';
  decision.confidence = confidenceScore;
  decision.reason = `All criteria met: ${confidenceScore.toFixed(0)}% confidence, ${alignment.alignedCount}/${AUTO_ENTRY_CONFIG.requiredTimeframes.length} timeframes aligned, R:R ${expectedRR.toFixed(1)}`;

  // Calculate suggested position parameters
  decision.suggestedPosition = calculateSuggestedPosition(analysis, account);
  
  // If position calculation failed, reject entry
  if (!decision.suggestedPosition) {
    decision.shouldEnter = false;
    decision.action = 'no_trade';
    decision.reason = 'Failed to calculate position parameters (invalid risk distance or position too small)';
    decision.suggestedPosition = null;
    return decision;
  }

  // Check if entry price is far from current price (limit order vs market order)
  const currentPrice = analysis.current_price || 0;
  const suggestedEntry = decision.suggestedPosition.entry_price;
  const priceDiff = Math.abs(suggestedEntry - currentPrice) / currentPrice;
  
  // If entry is more than 0.5% away from current price, treat as limit order (pending)
  if (priceDiff > 0.005) {
    decision.orderType = 'limit'; // Will create pending order
    decision.reason += ` | Limit order: entry ${suggestedEntry.toFixed(2)} vs current ${currentPrice.toFixed(2)} (${(priceDiff * 100).toFixed(2)}% away)`;
    // For limit orders, keep the suggested entry (waiting for price to hit)
  } else {
    decision.orderType = 'market'; // Execute immediately
    decision.reason += ` | Market order: entry at current price ${currentPrice.toFixed(2)} (suggested was ${suggestedEntry.toFixed(2)})`;
    // CRITICAL FIX: For market orders, entry price must be current market price, not suggested!
    decision.suggestedPosition.entry_price = currentPrice;
    // Recalculate size based on new entry price
    const newSizeUsd = decision.suggestedPosition.size_qty * currentPrice;
    decision.suggestedPosition.size_usd = newSizeUsd;
    console.log(`[AutoEntry] Market order adjusted: entry=${currentPrice}, size_usd=${newSizeUsd.toFixed(2)}`);
  }

  return decision;
}

/**
 * Check if required timeframes align with the bias
 */
function checkTimeframeAlignment(analysis, requiredTimeframes) {
  const bias = analysis.bias;
  const predictions = analysis.predictions || {};
  
  let alignedCount = 0;
  const details = {};

  requiredTimeframes.forEach(tf => {
    const pred = predictions[tf];
    if (!pred) {
      details[tf] = 'no_data';
      return;
    }

    const direction = pred.direction;
    let isAligned = false;

    if (bias === 'bullish' && direction === 'up') {
      isAligned = true;
    } else if (bias === 'bearish' && direction === 'down') {
      isAligned = true;
    } else if (direction === 'sideways') {
      isAligned = false;
    }

    if (isAligned) {
      alignedCount++;
    }
    details[tf] = { direction, aligned: isAligned, confidence: pred.confidence };
  });

  return {
    alignedCount,
    total: requiredTimeframes.length,
    details
  };
}

/**
 * Calculate suggested position parameters based on ICT concepts
 */
function calculateSuggestedPosition(analysis, account) {
  const currentPrice = analysis.current_price || 0;
  const bias = analysis.bias;
  const riskAmount = account.current_balance * AUTO_ENTRY_CONFIG.riskPerTrade;

  // Use AI suggested entry for limit orders (or fallback to current price)
  const suggestedEntry = analysis.suggested_entry || currentPrice;
  const suggestedSL = analysis.suggested_stop_loss;
  const suggestedTP = analysis.suggested_take_profit;

  let stopLoss, takeProfit;

  if (bias === 'bullish') {
    // Long position
    stopLoss = suggestedSL || currentPrice * 0.98; // Default 2% below current
    takeProfit = suggestedTP || currentPrice * 1.04; // Default 4% above current (1:2 R:R)
  } else {
    // Short position
    stopLoss = suggestedSL || currentPrice * 1.02; // Default 2% above current
    takeProfit = suggestedTP || currentPrice * 0.96; // Default 4% below current (1:2 R:R)
  }

  // Calculate position size based on risk
  const riskDistance = Math.abs(suggestedEntry - stopLoss);
  
  // Validate risk distance
  if (riskDistance <= 0) {
    console.error('[AutoEntry] Invalid risk distance (entry equals stop loss)');
    return null;
  }
  
  const sizeQty = riskAmount / riskDistance;
  const sizeUsd = sizeQty * suggestedEntry;

  // Validate minimum position size (at least $1)
  if (sizeUsd < 1) {
    console.error('[AutoEntry] Position size too small:', sizeUsd);
    return null;
  }

  // Calculate actual R:R
  const rewardDistance = Math.abs(takeProfit - suggestedEntry);
  const actualRR = riskDistance > 0 ? rewardDistance / riskDistance : 0;

  console.log(`[AutoEntry] Position calc: suggested_entry=${suggestedEntry}, current=${currentPrice}, SL=${stopLoss}, TP=${takeProfit}, RR=${actualRR.toFixed(2)}`);

  return {
    side: bias === 'bullish' ? 'long' : 'short',
    entry_price: suggestedEntry,
    current_price: currentPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    size_usd: sizeUsd,
    size_qty: sizeQty,
    risk_usd: riskAmount,
    risk_percent: AUTO_ENTRY_CONFIG.riskPerTrade * 100,
    expected_rr: actualRR,
    invalidation_level: analysis.invalidation_level || stopLoss
  };
}

/**
 * Check if account should enter cooldown after a loss
 */
export function shouldEnterCooldown(account, isLoss) {
  if (!isLoss) {
    return { shouldCooldown: false, reason: 'Trade was profitable' };
  }

  const newConsecutiveLosses = (account.consecutive_losses || 0) + 1;

  if (newConsecutiveLosses >= AUTO_ENTRY_CONFIG.maxConsecutiveLosses) {
    const cooldownUntil = new Date();
    cooldownUntil.setHours(cooldownUntil.getHours() + AUTO_ENTRY_CONFIG.cooldownHours);
    
    return {
      shouldCooldown: true,
      cooldownUntil: cooldownUntil.toISOString(),
      consecutiveLosses: newConsecutiveLosses,
      reason: `${newConsecutiveLosses} consecutive losses, entering ${AUTO_ENTRY_CONFIG.cooldownHours}h cooldown`
    };
  }

  return {
    shouldCooldown: false,
    consecutiveLosses: newConsecutiveLosses,
    reason: `${newConsecutiveLosses} consecutive losses, below threshold of ${AUTO_ENTRY_CONFIG.maxConsecutiveLosses}`
  };
}

/**
 * Reset consecutive losses after a win
 */
export function resetConsecutiveLosses() {
  return {
    consecutiveLosses: 0,
    reason: 'Trade was profitable, resetting loss streak'
  };
}

export { AUTO_ENTRY_CONFIG };
