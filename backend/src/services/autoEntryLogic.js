// Auto-Entry Logic for Paper Trading
// Determines when to suggest opening positions based on ICT analysis

const AUTO_ENTRY_CONFIG = {
  minConfidence: 70,           // Minimum confidence score (0-100) - Updated 18/04/2026
  minRRRatio: 2.0,             // Minimum risk/reward ratio
  riskPerTrade: 0.01,          // 1% of account balance
  maxPositionsPerSymbol: 9,    // Max concurrent positions per symbol (BTC only) - Updated 20/04/2026
  maxConsecutiveLosses: 8,     // Trigger cooldown
  cooldownHours: 4,            // Cooldown duration in hours
  requiredTimeframes: ['1h', '4h'],  // Check these for alignment - Updated 17/04/2026 (1h primary)
  minAlignment: 0.5,           // Majority (50%+) required
  enabledSymbols: ['BTC'],     // Only enable BTC trading
  // Trading sessions - Updated to all timeframes (no session restrictions)
  allowedSessions: ['all_timeframes'],  // Trade during all market hours
  tradingHours: { start: 0, end: 24 },  // 24/7 trading enabled
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
 * Check for duplicate positions before opening new position
 * @param {Object} db - Database instance
 * @param {string} symbol - Trading symbol (BTC, ETH)
 * @param {string} side - Position side (long, short)
 * @param {number} suggestedEntry - Suggested entry price
 * @param {number} currentPrice - Current market price
 * @param {number} confidence - Analysis confidence (0-100)
 * @returns {Promise<Object>} - { shouldSkip: boolean, reason: string }
 */
async function checkDuplicatePosition(db, symbol, side, suggestedEntry, currentPrice, confidence) {
  const { getPositions } = await import('../db/database.js');

  // Get open positions for this symbol
  const openPositions = await getPositions(db, { symbol, status: 'open' });

  // Get pending orders for this symbol
  const { getPendingOrders } = await import('../db/database.js');
  const pendingOrders = await getPendingOrders(db, { symbol, status: 'pending' });

  // Check for duplicate entries (within 0.5% price range, ~$375 for BTC at $75,000)
  const priceTolerance = currentPrice * 0.005;

  // Check open positions
  const duplicateInOpen = openPositions.some(pos =>
    pos.side === side &&
    Math.abs(pos.entry_price - suggestedEntry) < priceTolerance
  );

  // Check pending orders
  const duplicateInPending = pendingOrders.some(order =>
    order.side === side &&
    Math.abs(order.price - suggestedEntry) < priceTolerance
  );

  const duplicateExists = duplicateInOpen || duplicateInPending;

  // If duplicate exists, require confidence >= 85% (fixed threshold, not percentage)
  if (duplicateExists && confidence < 85) {
    return {
      shouldSkip: true,
      reason: `Duplicate position/order exists. Confidence ${confidence}% < threshold 85%`
    };
  }

  return { shouldSkip: false };
}


/**
 * Check if current time is within allowed trading sessions
 * @param {Object} config - Configuration object (optional, defaults to AUTO_ENTRY_CONFIG)
 */
function isWithinAllowedSessions(config = AUTO_ENTRY_CONFIG) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  
  const sessions = config.allowedSessions;
  
  // Check if all timeframes are enabled
  if (sessions.includes('all_timeframes')) {
    return true; // Always allow trading for all timeframes
  }
  
  // Fallback to session-based trading (for backward compatibility)
  for (const session of sessions) {
    if (session === 'london') {
      const { start, end } = config.londonSession || AUTO_ENTRY_CONFIG.londonSession;
      if (utcHour >= start && utcHour < end) return true;
    } else if (session === 'ny_killzone') {
      const { start, end } = config.nyKillzone || AUTO_ENTRY_CONFIG.nyKillzone;
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
 * @param {Object} methodConfig - Method-specific configuration (optional, defaults to AUTO_ENTRY_CONFIG)
 * @param {Object} db - Database instance (for duplicate position check)
 * @returns {Promise<Object>} Entry decision with reasoning
 */
export async function evaluateAutoEntry(analysis, account, openPositions = [], methodConfig = null, db = null) {
  // Use method-specific config if provided, otherwise use default
  const config = methodConfig || AUTO_ENTRY_CONFIG;
  
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
  if (!config.enabledSymbols.includes(symbol)) {
    decision.reason = `Trading disabled for ${symbol}. Only ${config.enabledSymbols.join(', ')} enabled`;
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

  // Check 2: Trading session timing
  if (!isWithinAllowedSessions(config)) {
    decision.reason = 'Outside allowed trading sessions';
    return decision;
  }

  // Check 3: Max positions per symbol
  if (openPositions.length >= config.maxPositionsPerSymbol) {
    decision.reason = `Maximum positions (${config.maxPositionsPerSymbol}) already open for ${symbol}`;
    return decision;
  }

  // Check 4: Confidence threshold
  const confidenceScore = analysis.confidence * 100;
  if (confidenceScore < config.minConfidence) {
    decision.reason = `Confidence too low (${confidenceScore.toFixed(0)}% < ${config.minConfidence}%)`;
    return decision;
  }

  // Check 5: Bias must be bullish or bearish
  if (!['bullish', 'bearish'].includes(analysis.bias)) {
    decision.reason = `Bias is neutral, no clear direction`;
    return decision;
  }

  // Check 6: Multi-timeframe alignment (4h and 1d only for ICT, H4 and H1 for KimNghia)
  const alignment = checkTimeframeAlignment(analysis, config.requiredTimeframes);
  if (alignment.alignedCount < config.requiredTimeframes.length * config.minAlignment) {
    decision.reason = `Multi-timeframe alignment insufficient (${alignment.alignedCount}/${config.requiredTimeframes.length} aligned)`;
    return decision;
  }

  // Check 7: AI action must be buy or sell (not hold)
  if (analysis.action !== 'buy' && analysis.action !== 'sell') {
    decision.reason = `AI action is '${analysis.action}' (not buy/sell)`;
    return decision;
  }

  // Check 8: Expected R:R ratio from analysis
  const expectedRR = analysis.expected_rr || 2.0;
  if (expectedRR < config.minRRRatio) {
    decision.reason = `Risk/Reward ratio too low (${expectedRR.toFixed(1)} < ${config.minRRRatio})`;
    return decision;
  }

  // All checks passed - suggest entry
  decision.shouldEnter = true;
  decision.action = analysis.bias === 'bullish' ? 'enter_long' : 'enter_short';
  decision.confidence = confidenceScore;
  decision.reason = `All criteria met: ${confidenceScore.toFixed(0)}% confidence, ${alignment.alignedCount}/${config.requiredTimeframes.length} timeframes aligned, R:R ${expectedRR.toFixed(1)}`;

  // Calculate suggested position parameters
  decision.suggestedPosition = calculateSuggestedPosition(analysis, account, config);
  
  // If position calculation failed, reject entry
  if (!decision.suggestedPosition) {
    decision.shouldEnter = false;
    decision.action = 'no_trade';
    decision.reason = 'Failed to calculate position parameters (invalid risk distance or position too small)';
    decision.suggestedPosition = null;
    return decision;
  }

  // Define variables needed for duplicate check and entry hit check
  const currentPrice = analysis.current_price || 0;
  const suggestedEntry = decision.suggestedPosition.entry_price;

  // Check for duplicate positions if db is available
  if (db && decision.shouldEnter) {
    const confidenceScore = analysis.confidence * 100;
    const side = decision.suggestedPosition.side;
    const duplicateCheck = await checkDuplicatePosition(
      db,
      symbol,
      side,
      suggestedEntry,
      currentPrice,
      confidenceScore
    );

    if (duplicateCheck.shouldSkip) {
      decision.shouldEnter = false;
      decision.action = 'no_trade';
      decision.reason = duplicateCheck.reason;
      decision.suggestedPosition = null;
      console.log(`[AutoEntry] ${duplicateCheck.reason}`);
      return decision;
    }
  }

  // Check if entry price is already hit by current market price
  const priceDiff = Math.abs(suggestedEntry - currentPrice) / currentPrice;
  const epsilon = 0.001; // Small tolerance for floating point comparison

  let entryAlreadyHit = false;

  if (decision.action === 'enter_long') {
    // For LONG: entry is hit if current price <= entry price (price already dropped to entry)
    entryAlreadyHit = currentPrice <= (suggestedEntry + epsilon);
  } else if (decision.action === 'enter_short') {
    // For SHORT: entry is hit if current price >= entry price (price already rose to entry)
    entryAlreadyHit = currentPrice >= (suggestedEntry - epsilon);
  }

  if (entryAlreadyHit) {
    // Entry already hit - execute as market order immediately
    decision.orderType = 'market';
    decision.suggestedPosition.entry_price = currentPrice; // Use current price as entry
    decision.reason += ` | Market order: entry ${suggestedEntry.toFixed(2)} already hit (current: ${currentPrice.toFixed(2)})`;
  } else {
    // Entry not yet hit - create pending limit order
    decision.orderType = 'limit'; // Will create pending order
    decision.reason += ` | Limit order: waiting for price to reach entry ${suggestedEntry.toFixed(2)} (current: ${currentPrice.toFixed(2)}, ${(priceDiff * 100).toFixed(2)}% away)`;
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
 * @param {Object} analysis - Analysis result
 * @param {Object} account - Account data
 * @param {Object} config - Configuration object (optional, defaults to AUTO_ENTRY_CONFIG)
 */
function calculateSuggestedPosition(analysis, account, config = AUTO_ENTRY_CONFIG) {
  const currentPrice = analysis.current_price || 0;
  const bias = analysis.bias;
  const riskAmount = account.current_balance * config.riskPerTrade;

  // Require AI-provided entry, SL, TP - with fallback calculation
  const suggestedEntry = analysis.suggested_entry || currentPrice;
  let suggestedSL = analysis.suggested_stop_loss;
  let suggestedTP = analysis.suggested_take_profit;

  // If AI didn't provide SL/TP, calculate defaults based on bias using suggested entry
  if (!suggestedSL || suggestedSL === 0) {
    console.warn('[AutoEntry] AI did not provide SL, calculating default based on bias using suggested entry');
    if (bias === 'bullish') {
      // LONG: SL 1% below entry
      suggestedSL = suggestedEntry * 0.99;
    } else if (bias === 'bearish') {
      // SHORT: SL 1% above entry
      suggestedSL = suggestedEntry * 1.01;
    }
  }

  if (!suggestedTP || suggestedTP === 0) {
    console.warn('[AutoEntry] AI did not provide TP, calculating default based on bias using suggested entry');
    if (bias === 'bullish') {
      // LONG: TP 2% above entry (R:R = 2:1)
      suggestedTP = suggestedEntry * 1.02;
    } else if (bias === 'bearish') {
      // SHORT: TP 2% below entry (R:R = 2:1)
      suggestedTP = suggestedEntry * 0.98;
    }
  }

  // Validate SL/TP placement based on bias
  if (bias === 'bullish') {
    // LONG: SL must be below entry, TP must be above entry
    if (suggestedSL >= suggestedEntry) {
      console.error(`[AutoEntry] LONG stop loss ${suggestedSL} must be below entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
    if (suggestedTP <= suggestedEntry) {
      console.error(`[AutoEntry] LONG take profit ${suggestedTP} must be above entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
  } else if (bias === 'bearish') {
    // SHORT: SL must be above entry, TP must be below entry
    if (suggestedSL <= suggestedEntry) {
      console.error(`[AutoEntry] SHORT stop loss ${suggestedSL} must be above entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
    if (suggestedTP >= suggestedEntry) {
      console.error(`[AutoEntry] SHORT take profit ${suggestedTP} must be below entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
  }

  let stopLoss = suggestedSL;
  let takeProfit = suggestedTP;

  // Calculate position size based on risk
  const riskDistance = Math.abs(suggestedEntry - stopLoss);

  // Validate risk distance is at least 1% of entry price (minimum reasonable stop loss)
  const minRiskDistance = suggestedEntry * 0.01; // 1% minimum
  if (riskDistance <= 0) {
    console.error('[AutoEntry] Invalid risk distance (entry equals stop loss)');
    return null;
  }
  if (riskDistance < minRiskDistance) {
    console.error(`[AutoEntry] Risk distance too small: ${riskDistance.toFixed(2)} (minimum ${minRiskDistance.toFixed(2)}, 1% of entry)`);
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

  return {
    side: bias === 'bullish' ? 'long' : 'short',
    entry_price: suggestedEntry,
    current_price: currentPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    size_usd: sizeUsd,
    size_qty: sizeQty,
    risk_usd: riskAmount,
    risk_percent: config.riskPerTrade * 100,
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
