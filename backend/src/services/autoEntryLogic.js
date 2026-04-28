// Auto-Entry Logic for Paper Trading
// Determines when to suggest opening positions based on ICT analysis

import { formatVietnamTime } from '../utils/dateHelpers.js';

/**
 * Calculate total volume of open positions and pending orders for an account
 * @param {Object} db - Database instance
 * @param {string} accountId - Account ID
 * @param {string} symbol - Trading symbol (BTC, ETH)
 * @returns {Promise<number>} Total volume in USD
 */
export async function calculateTotalVolume(db, accountId, symbol) {
  const { getPositions, getPendingOrders } = await import('../db/database.js');
  
  const openPositions = await getPositions(db, { account_id: accountId, symbol, status: 'open' });
  const pendingOrders = await getPendingOrders(db, { account_id: accountId, symbol, status: 'pending' });
  
  const openVolume = openPositions.reduce((sum, pos) => sum + (pos.size_usd || 0), 0);
  const pendingVolume = pendingOrders.reduce((sum, order) => sum + (order.size_usd || 0), 0);
  
  return openVolume + pendingVolume;
}

/**
 * Validate if entry price aligns with SL or TP of existing open positions
 * Used for strategic entry validation when volume is at limit
 * @param {number} entryPrice - Suggested entry price
 * @param {Array} openPositions - Array of open position objects
 * @param {number} tolerance - Tolerance percentage (default 0.005 = 0.5%)
 * @returns {boolean} True if entry aligns with SL/TP of any existing position
 */
export function validateStrategicEntry(entryPrice, openPositions, tolerance = 0.005) {
  if (!openPositions || openPositions.length === 0) {
    return true; // No positions to validate against, allow entry
  }
  
  for (const position of openPositions) {
    const slDistance = Math.abs(entryPrice - position.stop_loss) / position.stop_loss;
    const tpDistance = Math.abs(entryPrice - position.take_profit) / position.take_profit;
    
    // Check if entry is within tolerance of SL or TP
    if (slDistance <= tolerance || tpDistance <= tolerance) {
      console.log(`[AutoEntry] Strategic entry validated: ${entryPrice.toFixed(2)} within ${tolerance * 100}% of position ${position.position_id} SL/TP`);
      return true;
    }
  }
  
  return false;
}

/**
 * Validate order logic (SL/TP placement based on side)
 * @param {string} side - Position side (long or short)
 * @param {number} entry - Entry price
 * @param {number} sl - Stop loss price
 * @param {number} tp - Take profit price
 * @param {string} methodId - Method ID (ict or kim_nghia) for method-specific thresholds
 * @returns {Promise<Object>} Validation result { valid: boolean, reason: string }
 */
export async function validateOrderLogic(side, entry, sl, tp, methodId = null) {
  if (!entry || !sl || !tp) {
    return { valid: false, reason: 'Entry, SL, and TP are required' };
  }
  
  if (side === 'long') {
    // LONG: SL must be below entry, TP must be above entry
    if (sl >= entry) {
      return { valid: false, reason: `LONG stop loss ${sl} must be below entry ${entry}` };
    }
    if (tp <= entry) {
      return { valid: false, reason: `LONG take profit ${tp} must be above entry ${entry}` };
    }
  } else if (side === 'short') {
    // SHORT: SL must be above entry, TP must be below entry
    if (sl <= entry) {
      return { valid: false, reason: `SHORT stop loss ${sl} must be above entry ${entry}` };
    }
    if (tp >= entry) {
      return { valid: false, reason: `SHORT take profit ${tp} must be below entry ${entry}` };
    }
  } else {
    return { valid: false, reason: `Invalid side: ${side}` };
  }
  
  // Validate minimum SL distance using method-specific threshold
  let minSLDistancePercent = 0.005; // Default 0.5% for backward compatibility
  
  if (methodId) {
    try {
      const { getMethodConfig } = await import('../config/methods.js');
      const methodConfig = getMethodConfig(methodId);
      minSLDistancePercent = methodConfig.autoEntry?.minSLDistancePercent || 0.005;
    } catch (error) {
      console.warn(`[AutoEntry] Failed to get method config for ${methodId}, using default 0.5%:`, error.message);
    }
  }
  
  const slDistance = Math.abs(sl - entry) / entry;
  if (slDistance < minSLDistancePercent) {
    return { valid: false, reason: `Stop loss too close to entry: ${(slDistance * 100).toFixed(2)}% (minimum ${(minSLDistancePercent * 100).toFixed(1)}% for ${methodId || 'default'})` };
  }
  
  return { valid: true, reason: 'Order logic valid' };
}

/**
 * Validate if entry price aligns with existing open positions
 * Prevents creating limit orders that would execute in invalid price zones
 * @param {number} entryPrice - Suggested entry price for new order
 * @param {string} side - Side of new order (long or short)
 * @param {Array} openPositions - Array of existing open position objects
 * @returns {Object} Validation result { valid: boolean, reason: string }
 */
export function validateEntryAlignmentWithPositions(entryPrice, side, openPositions) {
  if (!openPositions || openPositions.length === 0) {
    return { valid: true, reason: 'No open positions to validate against' };
  }
  
  for (const position of openPositions) {
    const posSide = position.side;
    const posSL = position.stop_loss;
    const posTP = position.take_profit;
    
    // Skip if position doesn't have SL/TP data
    if (!posSL || !posTP) {
      continue;
    }
    
    // If sides are different, no conflict (short vs long can coexist)
    if (side !== posSide) {
      continue;
    }
    
    // Same side - check entry alignment
    if (side === 'short') {
      // SHORT: Entry must be >= SL OR <= TP (cannot be between TP and SL)
      // TP < entry < SL is INVALID because price would hit TP before entry
      if (posTP < entryPrice && entryPrice < posSL) {
        return { 
          valid: false, 
          reason: `SHORT entry ${entryPrice.toFixed(2)} is between TP ${posTP.toFixed(2)} and SL ${posSL.toFixed(2)} of existing position ${position.position_id}. Entry must be >= SL or <= TP to avoid executing in invalid zone.` 
        };
      }
    } else if (side === 'long') {
      // LONG: Entry must be >= TP OR <= SL (cannot be between SL and TP)
      // SL < entry < TP is INVALID because price would hit SL before entry
      if (posSL < entryPrice && entryPrice < posTP) {
        return { 
          valid: false, 
          reason: `LONG entry ${entryPrice.toFixed(2)} is between SL ${posSL.toFixed(2)} and TP ${posTP.toFixed(2)} of existing position ${position.position_id}. Entry must be >= TP or <= SL to avoid executing in invalid zone.` 
        };
      }
    }
  }
  
  return { valid: true, reason: 'Entry aligns with existing positions' };
}

const AUTO_ENTRY_CONFIG = {
  minConfidence: 70,           // Minimum confidence score (0-100) - Updated 18/04/2026
  minRRRatio: 2.0,             // Minimum risk/reward ratio
  riskPerTrade: 0.01,          // 1% of account balance
  maxPositionsPerSymbol: 6,    // Max concurrent positions per symbol - Updated 21/04/2026
  maxConsecutiveLosses: 3,     // Trigger cooldown - Updated 23/04/2026 (was 8)
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
 * Recalculate SL/TP for market orders when entry price changes to current price
 * Maintains the same percentage distance from the original entry/SL/TP relationship
 * @param {Object} suggestedPosition - Position object with original entry, SL, TP
 * @param {number} newEntryPrice - New entry price (current market price)
 * @param {string} side - Position side (long or short)
 * @param {string} methodId - Method ID for method-specific thresholds
 * @returns {Object|null} Recalculated position with new SL/TP, or null if invalid
 */
async function recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, side, methodId = null) {
  const originalEntry = suggestedPosition.entry_price;
  const originalSL = suggestedPosition.stop_loss;
  const originalTP = suggestedPosition.take_profit;

  console.log(`[AutoEntry] Recalculating SL/TP for market order:`, {
    original_entry: originalEntry,
    original_sl: originalSL,
    original_tp: originalTP,
    new_entry: newEntryPrice,
    side
  });

  // Calculate percentage distances from original entry
  let slDistancePercent = 0;
  let tpDistancePercent = 0;

  if (originalSL && originalSL !== 0) {
    slDistancePercent = Math.abs(originalSL - originalEntry) / originalEntry;
  }

  if (originalTP && originalTP !== 0) {
    tpDistancePercent = Math.abs(originalTP - originalEntry) / originalEntry;
  }

  // If no original SL/TP provided, use method-specific minimum distances
  let minSLDistancePercent = 0.005; // Default 0.5%
  
  if (methodId) {
    try {
      const { getMethodConfig } = await import('../config/methods.js');
      const methodConfig = getMethodConfig(methodId);
      minSLDistancePercent = methodConfig.autoEntry?.minSLDistancePercent || 0.005;
    } catch (error) {
      console.warn(`[AutoEntry] Failed to get method config for ${methodId}, using default 0.5%:`, error.message);
    }
  }

  // If no original SL distance, use minimum
  if (slDistancePercent === 0) {
    slDistancePercent = minSLDistancePercent;
  }

  // If no original TP distance, use 2x SL distance (R:R 2:1)
  if (tpDistancePercent === 0) {
    tpDistancePercent = slDistancePercent * 2;
  }

  // Recalculate SL and TP based on new entry price
  let newSL, newTP;

  if (side === 'long') {
    // LONG: SL below entry, TP above entry
    newSL = newEntryPrice * (1 - slDistancePercent);
    newTP = newEntryPrice * (1 + tpDistancePercent);
  } else if (side === 'short') {
    // SHORT: SL above entry, TP below entry
    newSL = newEntryPrice * (1 + slDistancePercent);
    newTP = newEntryPrice * (1 - tpDistancePercent);
  } else {
    console.error(`[AutoEntry] Invalid side for SL/TP recalculation: ${side}`);
    return null;
  }

  // Validate recalculated SL distance meets minimum threshold
  const newSLDistance = Math.abs(newSL - newEntryPrice) / newEntryPrice;
  if (newSLDistance < minSLDistancePercent) {
    console.error(`[AutoEntry] Recalculated SL distance too small: ${(newSLDistance * 100).toFixed(2)}% (minimum ${(minSLDistancePercent * 100).toFixed(1)}% for ${methodId || 'default'})`);
    return null;
  }

  console.log(`[AutoEntry] SL/TP recalculation successful:`, {
    original_sl_distance_pct: (slDistancePercent * 100).toFixed(2),
    original_tp_distance_pct: (tpDistancePercent * 100).toFixed(2),
    new_sl: newSL.toFixed(2),
    new_tp: newTP.toFixed(2),
    new_sl_distance_pct: (newSLDistance * 100).toFixed(2),
    new_tp_distance_pct: (tpDistancePercent * 100).toFixed(2)
  });

  // Return updated position with recalculated SL/TP
  return {
    ...suggestedPosition,
    entry_price: newEntryPrice,
    stop_loss: newSL,
    take_profit: newTP
  };
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
  // methodConfig can be either the full method object or just autoEntry config
  const config = methodConfig?.autoEntry || methodConfig || AUTO_ENTRY_CONFIG;
  
  // Extract methodId early for use in confluence check
  const methodId = methodConfig?.methodId || null;
  
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
    console.log(`[AutoEntry] Check 0 FAILED: Trading disabled for ${symbol}. Only ${config.enabledSymbols.join(', ')} enabled`);
    decision.reason = `Trading disabled for ${symbol}. Only ${config.enabledSymbols.join(', ')} enabled`;
    return decision;
  }
  console.log(`[AutoEntry] Check 0 PASSED: Symbol ${symbol} enabled`);

  // Check 1: Account cooldown
  if (account.cooldown_until) {
    const cooldownEnd = new Date(account.cooldown_until);
    if (new Date() < cooldownEnd) {
      console.log(`[AutoEntry] Check 1 FAILED: Account in cooldown until ${formatVietnamTime(cooldownEnd)} (after ${account.consecutive_losses} consecutive losses)`);
      decision.reason = `Account in cooldown until ${formatVietnamTime(cooldownEnd)} (after ${account.consecutive_losses} consecutive losses)`;
      return decision;
    }
  }
  console.log(`[AutoEntry] Check 1 PASSED: No account cooldown`);

  // Check 2: Trading session timing
  if (!isWithinAllowedSessions(config)) {
    console.log(`[AutoEntry] Check 2 FAILED: Outside allowed trading sessions`);
    decision.reason = 'Outside allowed trading sessions';
    return decision;
  }
  console.log(`[AutoEntry] Check 2 PASSED: Within allowed trading sessions`);

  // Check 3: Max positions per symbol
  if (openPositions.length >= config.maxPositionsPerSymbol) {
    console.log(`[AutoEntry] Check 3 FAILED: Maximum positions (${config.maxPositionsPerSymbol}) already open for ${symbol}`);
    decision.reason = `Maximum positions (${config.maxPositionsPerSymbol}) already open for ${symbol}`;
    return decision;
  }
  console.log(`[AutoEntry] Check 3 PASSED: Open positions ${openPositions.length}/${config.maxPositionsPerSymbol}`);

  // Check 3.5: Max volume per account (including pending orders)
  if (config.maxVolumePerAccount) {
    const totalOpenVolume = openPositions.reduce((sum, pos) => sum + (pos.size_usd || 0), 0);
    
    // Calculate pending order volume
    let totalPendingVolume = 0;
    if (db) {
      try {
        const { getPendingOrders } = await import('../db/database.js');
        const pendingOrders = await getPendingOrders(db, { account_id: account.id, symbol, status: 'pending' });
        totalPendingVolume = pendingOrders.reduce((sum, order) => sum + (order.size_usd || 0), 0);
        console.log(`[AutoEntry] Pending order volume: $${totalPendingVolume.toFixed(2)} (${pendingOrders.length} orders)`);
      } catch (error) {
        console.log(`[AutoEntry] Failed to fetch pending orders for volume check:`, error.message);
      }
    }
    
    const suggestedVolume = decision.suggestedPosition?.size_usd || 0;
    const totalVolume = totalOpenVolume + totalPendingVolume + suggestedVolume;
    
    if (totalVolume > config.maxVolumePerAccount) {
      console.log(`[AutoEntry] Check 3.5 FAILED: Total volume $${totalVolume.toFixed(2)} (open: $${totalOpenVolume.toFixed(2)}, pending: $${totalPendingVolume.toFixed(2)}, new: $${suggestedVolume.toFixed(2)}) exceeds max $${config.maxVolumePerAccount} for account`);
      decision.reason = `Total volume $${totalVolume.toFixed(2)} exceeds max $${config.maxVolumePerAccount} for account`;
      return decision;
    }
    console.log(`[AutoEntry] Check 3.5 PASSED: Total volume $${totalVolume.toFixed(2)} (open: $${totalOpenVolume.toFixed(2)}, pending: $${totalPendingVolume.toFixed(2)}, new: $${suggestedVolume.toFixed(2)}) <= max $${config.maxVolumePerAccount}`);
  }
  
  // Check 3.6: Strategic entry validation when volume is at limit
  if (config.maxVolumePerAccount && db) {
    const currentVolume = await calculateTotalVolume(db, account.id, symbol);
    const suggestedVolume = decision.suggestedPosition?.size_usd || 0;
    const projectedVolume = currentVolume + suggestedVolume;
    
    // If projected volume is at 90% or more of limit, validate strategic entry
    const volumeThreshold = config.maxVolumePerAccount * 0.9;
    if (projectedVolume >= volumeThreshold) {
      const suggestedEntry = decision.suggestedPosition?.entry_price;
      const isStrategicEntry = validateStrategicEntry(suggestedEntry, openPositions);
      
      if (!isStrategicEntry) {
        console.log(`[AutoEntry] Check 3.6 FAILED: Volume at limit ($${projectedVolume.toFixed(2)} / $${config.maxVolumePerAccount}), entry $${suggestedEntry?.toFixed(2) || 'N/A'} not at strategic level (SL/TP of existing positions)`);
        decision.reason = `Volume at limit, entry not at strategic level (must align with SL/TP of existing positions)`;
        return decision;
      }
      console.log(`[AutoEntry] Check 3.6 PASSED: Volume at limit but entry $${suggestedEntry?.toFixed(2) || 'N/A'} is at strategic level`);
    }
  }

  // Check 4: Confidence threshold
  const confidenceScore = (analysis.confidence || 0) * 100;
  console.log(`[AutoEntry] Check 4: Confidence ${confidenceScore.toFixed(0)}% vs threshold ${config.minConfidence}%`);
  if (confidenceScore < config.minConfidence) {
    console.log(`[AutoEntry] Check 4 FAILED: Confidence too low (${confidenceScore.toFixed(0)}% < ${config.minConfidence}%)`);
    decision.reason = `Confidence too low (${confidenceScore.toFixed(0)}% < ${config.minConfidence}%)`;
    return decision;
  }
  console.log(`[AutoEntry] Check 4 PASSED: Confidence ${confidenceScore.toFixed(0)}% >= ${config.minConfidence}%`);

  // Check 5: Bias must be bullish or bearish
  if (!['bullish', 'bearish'].includes(analysis.bias)) {
    console.log(`[AutoEntry] Check 5 FAILED: Bias is neutral (${analysis.bias}), no clear direction`);
    decision.reason = `Bias is neutral, no clear direction`;
    return decision;
  }
  console.log(`[AutoEntry] Check 5 PASSED: Bias is ${analysis.bias}`);

  // Check 6: Multi-timeframe alignment (4h and 1d only for ICT, H4 and H1 for KimNghia)
  // Skip for Kim Nghia method since it doesn't use timeframe predictions
  console.log(`[AutoEntry] Check 6 DEBUG: methodConfig = ${methodConfig ? JSON.stringify({methodId: methodConfig.methodId, name: methodConfig.name}) : 'null'}`);
  let alignment = null;
  if (methodConfig && methodConfig.methodId === 'kim_nghia') {
    console.log(`[AutoEntry] Check 6 SKIPPED: Kim Nghia method doesn't use timeframe predictions`);
    alignment = { alignedCount: 0, details: {} }; // Set default for Kim Nghia
  } else {
    alignment = checkTimeframeAlignment(analysis, config.requiredTimeframes);
    console.log(`[AutoEntry] Check 6: Timeframe alignment - Required: ${config.requiredTimeframes.join(', ')}, Aligned: ${alignment.alignedCount}/${config.requiredTimeframes.length}, Details:`, alignment.details);
    if (alignment.alignedCount < config.requiredTimeframes.length * config.minAlignment) {
      decision.reason = `Multi-timeframe alignment insufficient (${alignment.alignedCount}/${config.requiredTimeframes.length} aligned)`;
      console.log(`[AutoEntry] Check 6 FAILED: ${decision.reason}`);
      return decision;
    }
    console.log(`[AutoEntry] Check 6 PASSED: Timeframe alignment sufficient`);
  }

  // Check 7: AI action must be buy or sell (not hold)
  console.log(`[AutoEntry] Check 7: AI action is '${analysis.action}'`);
  if (analysis.action !== 'buy' && analysis.action !== 'sell') {
    console.log(`[AutoEntry] Check 7 FAILED: AI action is '${analysis.action}' (not buy/sell)`);
    decision.reason = `AI action is '${analysis.action}' (not buy/sell)`;
    return decision;
  }
  console.log(`[AutoEntry] Check 7 PASSED: AI action is ${analysis.action}`);

  // Check 7.5: AI action must match bias
  const expectedAction = analysis.bias === 'bullish' ? 'buy' : 'sell';
  console.log(`[AutoEntry] Check 7.5: AI action '${analysis.action}' vs expected '${expectedAction}' for bias '${analysis.bias}'`);
  if (analysis.action !== expectedAction) {
    console.log(`[AutoEntry] Check 7.5 FAILED: AI action '${analysis.action}' does not match bias '${analysis.bias}' (expected '${expectedAction}')`);
    decision.reason = `AI action '${analysis.action}' does not match bias '${analysis.bias}' (expected '${expectedAction}')`;
    return decision;
  }
  console.log(`[AutoEntry] Check 7.5 PASSED: AI action matches bias`);

  // Check 8: Expected R:R ratio from analysis
  const expectedRR = analysis.expected_rr || 2.0;
  console.log(`[AutoEntry] Check 8: Expected R:R ${expectedRR.toFixed(1)} vs threshold ${config.minRRRatio}`);
  if (expectedRR < config.minRRRatio) {
    console.log(`[AutoEntry] Check 8 FAILED: Risk/Reward ratio too low (${expectedRR.toFixed(1)} < ${config.minRRRatio})`);
    decision.reason = `Risk/Reward ratio too low (${expectedRR.toFixed(1)} < ${config.minRRRatio})`;
    return decision;
  }
  console.log(`[AutoEntry] Check 8 PASSED: R:R ${expectedRR.toFixed(1)} >= ${config.minRRRatio}`);

  // Check 9: Confluence filters - Method-specific rules
  let confluence;
  let confluenceRequired;
  let confluenceMinMet;

  if (methodId === 'kim_nghia') {
    // Kim Nghia method: No multi-timeframe alignment requirement, looser thresholds
    confluence = {
      volumeConfirmation: analysis.volume && analysis.avgVolume ? analysis.volume > analysis.avgVolume * 1.2 : null,
      liquiditySweep: analysis.liquidity_sweep_detected === true,
      orderBlockNearby: analysis.order_block_distance !== undefined && analysis.order_block_distance <= 0.01,
      fvgNearby: analysis.fvg_distance !== undefined && analysis.fvg_distance <= 0.01
    };
    confluenceRequired = true;
    confluenceMinMet = 2; // 2/4 met for Kim Nghia
  } else {
    // ICT method: Multi-timeframe alignment required, stricter thresholds
    confluence = {
      multiTimeframeAlignment: alignment.alignedCount >= 1,
      volumeConfirmation: analysis.volume && analysis.avgVolume ? analysis.volume > analysis.avgVolume * 1.2 : null,
      liquiditySweep: analysis.liquidity_sweep_detected === true,
      orderBlockNearby: analysis.order_block_distance !== undefined && analysis.order_block_distance < 0.005,
      fvgNearby: analysis.fvg_distance !== undefined && analysis.fvg_distance < 0.005
    };
    confluenceRequired = config.requireConfluence;
    confluenceMinMet = 3; // 3/5 met for ICT
  }

  // Log each field for debugging
  console.log(`[AutoEntry] Check 9: Confluence field values (${methodId}):`);
  if (methodId === 'kim_nghia') {
    console.log(`  - volumeConfirmation: ${confluence.volumeConfirmation} (volume=${analysis.volume}, avgVolume=${analysis.avgVolume})`);
    console.log(`  - liquiditySweep: ${confluence.liquiditySweep} (liquidity_sweep_detected=${analysis.liquidity_sweep_detected})`);
    console.log(`  - orderBlockNearby: ${confluence.orderBlockNearby} (order_block_distance=${analysis.order_block_distance}, threshold=0.01)`);
    console.log(`  - fvgNearby: ${confluence.fvgNearby} (fvg_distance=${analysis.fvg_distance}, threshold=0.01)`);
  } else {
    console.log(`  - multiTimeframeAlignment: ${confluence.multiTimeframeAlignment} (alignment.alignedCount=${alignment.alignedCount})`);
    console.log(`  - volumeConfirmation: ${confluence.volumeConfirmation} (volume=${analysis.volume}, avgVolume=${analysis.avgVolume})`);
    console.log(`  - liquiditySweep: ${confluence.liquiditySweep} (liquidity_sweep_detected=${analysis.liquidity_sweep_detected})`);
    console.log(`  - orderBlockNearby: ${confluence.orderBlockNearby} (order_block_distance=${analysis.order_block_distance}, threshold=0.005)`);
    console.log(`  - fvgNearby: ${confluence.fvgNearby} (fvg_distance=${analysis.fvg_distance}, threshold=0.005)`);
  }

  // Only count non-null values
  const confluenceValues = Object.values(confluence).filter(v => v !== null);
  const confluenceCount = confluenceValues.filter(v => v).length;
  const confluenceTotal = confluenceValues.length;
  
  console.log(`[AutoEntry] Check 9: Confluence ${confluenceCount}/${confluenceTotal} met (min required: ${confluenceMinMet})`);

  // Only enforce if method requires confluence and we have enough checks
  if (confluenceRequired && confluenceTotal >= 2 && confluenceCount < confluenceMinMet) {
    decision.reason = `Insufficient confluence (${confluenceCount}/${confluenceTotal} met, minimum ${confluenceMinMet} required)`;
    console.log(`[AutoEntry] Check 9 FAILED: ${decision.reason}`);
    return decision;
  }
  console.log(`[AutoEntry] Check 9 PASSED: Confluence sufficient`);

  // Check 10: Trading session filter (high liquidity only)
  const now = new Date();
  const utcHour = now.getUTCHours();

  const highLiquiditySessions = [
    { name: 'London Killzone', start: 7, end: 10 },
    { name: 'NY Killzone', start: 12, end: 15 }
  ];

  const inHighLiquiditySession = highLiquiditySessions.some(session => 
    utcHour >= session.start && utcHour < session.end
  );

  console.log(`[AutoEntry] Check 10: Current UTC hour ${utcHour}, in high liquidity session: ${inHighLiquiditySession}`);

  if (!inHighLiquiditySession) {
    decision.reason = 'Outside high liquidity trading sessions (London/NY killzones)';
    console.log(`[AutoEntry] Check 10 FAILED: ${decision.reason}`);
    return decision;
  }
  console.log(`[AutoEntry] Check 10 PASSED: In high liquidity session`);

  // Check 11: Market structure filter - Optional if fields missing
  const structure = {
    hasBOS: analysis.break_of_structure === true,
    hasCHOCH: analysis.change_of_character === true,
    isNotChoppy: analysis.range_width === undefined || analysis.range_width < 0.01
  };

  console.log(`[AutoEntry] Check 11: Market structure`, structure);

  // For trend following: require BOS only if field exists
  if ((analysis.bias === 'bullish' || analysis.bias === 'bearish') && analysis.break_of_structure !== undefined) {
    if (!structure.hasBOS) {
      decision.reason = 'No Break of Structure detected for trend following entry';
      console.log(`[AutoEntry] Check 11 FAILED: ${decision.reason}`);
      return decision;
    }
  }

  // Reject if market is choppy only if range_width is provided
  if (analysis.range_width !== undefined && !structure.isNotChoppy) {
    decision.reason = 'Market is choppy (range width > 1%), no clear trend';
    console.log(`[AutoEntry] Check 11 FAILED: ${decision.reason}`);
    return decision;
  }

  console.log(`[AutoEntry] Check 11 PASSED: Market structure valid`);

  // All checks passed - suggest entry
  decision.shouldEnter = true;
  decision.action = analysis.bias === 'bullish' ? 'enter_long' : 'enter_short';
  decision.confidence = confidenceScore;
  
  // Build reason string (include alignment info only if check was performed)
  if (methodConfig && methodConfig.methodId === 'kim_nghia') {
    decision.reason = `All criteria met: ${confidenceScore.toFixed(0)}% confidence, R:R ${expectedRR.toFixed(1)}`;
  } else {
    decision.reason = `All criteria met: ${confidenceScore.toFixed(0)}% confidence, ${alignment.alignedCount}/${config.requiredTimeframes.length} timeframes aligned, R:R ${expectedRR.toFixed(1)}`;
  }

  // Calculate suggested position parameters
  decision.suggestedPosition = await calculateSuggestedPosition(analysis, account, config, methodId);
  
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

  // Check if entry price aligns with existing open positions
  if (db && decision.shouldEnter && openPositions.length > 0) {
    const side = decision.suggestedPosition.side;
    const alignmentValidation = validateEntryAlignmentWithPositions(suggestedEntry, side, openPositions);
    
    if (!alignmentValidation.valid) {
      decision.shouldEnter = false;
      decision.action = 'no_trade';
      decision.reason = alignmentValidation.reason;
      decision.suggestedPosition = null;
      console.log(`[AutoEntry] ${alignmentValidation.reason}`);
      return decision;
    }
    console.log(`[AutoEntry] Entry alignment validation passed: ${alignmentValidation.reason}`);
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
    
    // Recalculate SL/TP based on new entry price to maintain proper distance
    const recalculatedPosition = await recalculateSLTPForMarketOrder(
      decision.suggestedPosition,
      currentPrice,
      decision.suggestedPosition.side,
      methodId
    );
    
    if (!recalculatedPosition) {
      // Recalculation failed - reject the trade
      decision.shouldEnter = false;
      decision.action = 'no_trade';
      decision.reason = `Market order rejected: Unable to recalculate SL/TP with valid distance for current price ${currentPrice.toFixed(2)}`;
      decision.suggestedPosition = null;
      console.log(`[AutoEntry] ${decision.reason}`);
      return decision;
    }
    
    // Update position with recalculated SL/TP
    decision.suggestedPosition = recalculatedPosition;
    decision.reason += ` | Market order: entry ${suggestedEntry.toFixed(2)} already hit (current: ${currentPrice.toFixed(2)}), SL/TP recalculated to maintain distance`;
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
 * @param {string} methodId - Method ID (ict or kim_nghia) for method-specific thresholds
 */
async function calculateSuggestedPosition(analysis, account, config = AUTO_ENTRY_CONFIG, methodId = null) {
  const currentPrice = analysis.current_price || 0;
  if (!currentPrice || currentPrice <= 0) {
    console.error('[AutoEntry] Invalid current price:', currentPrice);
    return null;
  }
  const bias = analysis.bias;
  const riskAmount = account.current_balance * config.riskPerTrade;

  // Require AI-provided entry, SL, TP - validate first, then fallback if null/undefined
  const suggestedEntry = analysis.suggested_entry || currentPrice;
  if (!suggestedEntry || suggestedEntry <= 0) {
    console.error('[AutoEntry] Invalid suggested entry:', suggestedEntry);
    return null;
  }
  let suggestedSL = analysis.suggested_stop_loss;
  let suggestedTP = analysis.suggested_take_profit;

  // Validate AI-provided SL/TP placement first (before fallback)
  if (suggestedSL && suggestedSL !== 0) {
    // AI provided SL, validate it
    if (bias === 'bullish' && suggestedSL >= suggestedEntry) {
      console.error(`[AutoEntry] AI-provided LONG stop loss ${suggestedSL} must be below entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
    if (bias === 'bearish' && suggestedSL <= suggestedEntry) {
      console.error(`[AutoEntry] AI-provided SHORT stop loss ${suggestedSL} must be above entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
  }
  
  if (suggestedTP && suggestedTP !== 0) {
    // AI provided TP, validate it
    if (bias === 'bullish' && suggestedTP <= suggestedEntry) {
      console.error(`[AutoEntry] AI-provided LONG take profit ${suggestedTP} must be above entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
    if (bias === 'bearish' && suggestedTP >= suggestedEntry) {
      console.error(`[AutoEntry] AI-provided SHORT take profit ${suggestedTP} must be below entry ${suggestedEntry} - rejecting trade`);
      return null;
    }
  }

  // If AI didn't provide SL/TP (null/undefined), calculate defaults based on bias using suggested entry
  // Note: Only use fallback if AI didn't provide values, not if they were invalid (invalid values already rejected above)
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

  // Final validation of SL/TP placement (including fallback values)
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

  // Validate risk distance using method-specific threshold
  let minSLDistancePercent = 0.003; // Default 0.3% minimum
  
  if (methodId) {
    try {
      const { getMethodConfig } = await import('../config/methods.js');
      const methodConfig = getMethodConfig(methodId);
      minSLDistancePercent = methodConfig.autoEntry?.minSLDistancePercent || 0.003;
    } catch (error) {
      console.warn(`[AutoEntry] Failed to get method config for ${methodId}, using default 0.3%:`, error.message);
    }
  }
  
  const minRiskDistance = suggestedEntry * minSLDistancePercent;
  if (riskDistance <= 0) {
    console.error('[AutoEntry] Invalid risk distance (entry equals stop loss)');
    return null;
  }
  if (riskDistance < minRiskDistance) {
    console.error(`[AutoEntry] Risk distance too small: ${riskDistance.toFixed(2)} (minimum ${minRiskDistance.toFixed(2)}, ${(minSLDistancePercent * 100).toFixed(1)}% of entry for ${methodId || 'default'})`);
    return null;
  }
  
  let sizeQty = riskAmount / riskDistance;
  let sizeUsd = sizeQty * suggestedEntry;

  // Cap position size at account balance * leverage (for futures trading)
  // Get leverage from binance config if available, default to 20x for testnet
  let leverage = 20; // Default 20x for testnet
  try {
    const { getLeverage } = await import('../config/binance.js');
    leverage = getLeverage() || 20;
  } catch (error) {
    console.warn('[AutoEntry] Failed to get leverage, using default 20x');
  }
  const maxPositionSizeByLeverage = account.current_balance * leverage;
  if (sizeUsd > maxPositionSizeByLeverage) {
    console.log(`[AutoEntry] Position size $${sizeUsd.toFixed(2)} exceeds leverage cap $${maxPositionSizeByLeverage.toFixed(2)} (${leverage}x), capping`);
    sizeUsd = maxPositionSizeByLeverage;
    // Recalculate sizeQty based on capped sizeUsd
    const newSizeQty = sizeUsd / suggestedEntry;
    if (newSizeQty > 0) {
      sizeQty = newSizeQty;
    }
  }

  // Cap position size at maxPositionSize (default 2000 USD)
  const maxPositionSize = config.maxPositionSize || 2000;
  if (sizeUsd > maxPositionSize) {
    console.log(`[AutoEntry] Position size $${sizeUsd.toFixed(2)} exceeds max $${maxPositionSize}, capping to $${maxPositionSize}`);
    sizeUsd = maxPositionSize;
    // Recalculate sizeQty based on capped sizeUsd
    const newSizeQty = sizeUsd / suggestedEntry;
    if (newSizeQty > 0) {
      sizeQty = newSizeQty;
    }
  }

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
    invalidation_level: analysis.invalidation_level || stopLoss,
    r_multiple: actualRR
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

export { AUTO_ENTRY_CONFIG, recalculateSLTPForMarketOrder };
