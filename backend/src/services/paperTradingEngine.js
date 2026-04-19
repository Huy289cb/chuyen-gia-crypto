// Paper Trading Engine
// Manages positions, calculates PnL, handles SL/TP, and account updates

import { randomUUID } from 'crypto';

const PAPER_TRADING_CONFIG = {
  partialTPEnabled: true,
  partialTPRatios: [0.5, 0.5],
  partialTPRRLevels: [1.0, 2.0],
  trailingStopEnabled: true,
  trailAfterRR: 1.0,
  trailDistancePct: 0.5,
  // Enhanced ICT-based strategies
  ictStrategies: {
    // R:R 2.0: 50% at 1:1 (move SL to entry), 50% at 2:1
    rr2: { ratios: [0.5, 0.5], levels: [1.0, 2.0], slMoves: [0, 1] },
    // R:R 3.0: 33% at 1:1 (move SL to entry), 33% at 2:1, 34% at 3:1
    rr3: { ratios: [0.33, 0.33, 0.34], levels: [1.0, 2.0, 3.0], slMoves: [0, 1, 2] },
    // R:R 5.0: 25% at 1:1 (move SL to entry), 25% at 2:1, 25% at 3:1, 25% at 5:1
    rr5: { ratios: [0.25, 0.25, 0.25, 0.25], levels: [1.0, 2.0, 3.0, 5.0], slMoves: [0, 1, 2, 3] },
    // R:R 7.0: 20% at each level with progressive SL tightening
    rr7: { ratios: [0.2, 0.2, 0.2, 0.2, 0.2], levels: [1.0, 2.0, 3.0, 5.0, 7.0], slMoves: [0, 1, 2, 3, 4] }
  }
};

/**
 * Check if any open positions should be closed due to prediction reversal
 * This runs only when new analysis is generated (every 15 minutes)
 */
export async function checkPredictionReversal(db, newAnalysis, symbol = 'BTC') {
  const { getPositions, getPosition } = await import('../db/database.js');
  const openPositions = await getPositions(db, { symbol, status: 'open' });
  
  if (openPositions.length === 0) {
    return { checked: 0, closed: [], errors: [] };
  }

  const results = {
    checked: openPositions.length,
    closed: [],
    errors: []
  };

  // Only check if new analysis has opposite bias and high confidence
  const newBias = newAnalysis.bias;
  const newConfidence = newAnalysis.confidence * 100;

  if (!newBias || newConfidence < 80) {
    return { ...results, reason: 'New analysis confidence too low or no bias' };
  }

  for (const position of openPositions) {
    try {
      const positionBias = position.side === 'long' ? 'bullish' : 'bearish';
      
      // Check if new analysis opposes position bias
      const isReversal = (newBias === 'bullish' && positionBias === 'bearish') ||
                        (newBias === 'bearish' && positionBias === 'bullish');

      if (isReversal) {
        console.log(`[PredictionReversal] Detected reversal for ${symbol}: position=${positionBias}, new_analysis=${newBias} (${newConfidence?.toFixed(0) || 'N/A'}% confidence)`);
        
        // Get current price for closure with error handling
        let currentPrice = position.current_price;
        try {
          const { fetchRealTimePrices } = await import('../price-fetcher.js');
          const priceData = await fetchRealTimePrices();
          currentPrice = priceData[symbol.toLowerCase()]?.price || position.current_price;
        } catch (priceError) {
          console.error(`[PredictionReversal] Failed to fetch current price, using position.current_price:`, priceError.message);
        }
        
        // Close position due to prediction reversal
        const closeResult = await closePosition(db, position, currentPrice, 'prediction_reversal');
        results.closed.push({
          position_id: position.position_id,
          reason: 'prediction_reversal',
          pnl: closeResult.realizedPnl,
          is_win: closeResult.isWin,
          new_bias: newBias,
          old_bias: positionBias
        });
        
        console.log(`[PredictionReversal] Closed position ${position.position_id} due to prediction reversal`);
      }
    } catch (error) {
      console.error(`[PredictionReversal] Error checking position ${position.id}:`, error.message);
      results.errors.push({ position_id: position.id, error: error.message });
    }
  }

  return results;
}

/**
 * Get ICT strategy based on R:R ratio
 */
function getICTStrategy(expectedRR) {
  if (expectedRR >= 7) return PAPER_TRADING_CONFIG.ictStrategies.rr7;
  if (expectedRR >= 5) return PAPER_TRADING_CONFIG.ictStrategies.rr5;
  if (expectedRR >= 3) return PAPER_TRADING_CONFIG.ictStrategies.rr3;
  return PAPER_TRADING_CONFIG.ictStrategies.rr2; // Default for R:R 2.0+
}

/**
 * Calculate TP levels based on ICT strategy
 */
function calculateICTTPLevels(entry, sl, strategy) {
  const riskDistance = Math.abs(entry - sl);
  const tpLevels = [];
  
  for (let i = 0; i < strategy.levels.length; i++) {
    const tpLevel = entry + (entry > sl ? riskDistance * strategy.levels[i] : -riskDistance * strategy.levels[i]);
    tpLevels.push(tpLevel);
  }
  
  return tpLevels;
}

/**
 * Calculate TP1 and TP2 levels based on R:R ratios (legacy function)
 */
function calculateTPLevels(entry, sl, rrLevels) {
  const riskDistance = Math.abs(entry - sl);
  return {
    tp1: entry + (entry > sl ? riskDistance * rrLevels[0] : -riskDistance * rrLevels[0]),
    tp2: entry + (entry > sl ? riskDistance * rrLevels[1] : -riskDistance * rrLevels[1])
  };
}

/**
 * Open a new position based on auto-entry suggestion
 */
export async function openPosition(db, account, suggestion, linkedPredictionId = null) {
  const positionId = randomUUID();
  
  // Determine ICT strategy based on expected R:R
  const ictStrategy = getICTStrategy(suggestion.expected_rr);
  const tpLevels = calculateICTTPLevels(suggestion.entry_price, suggestion.stop_loss, ictStrategy);
  
  const positionData = {
    position_id: positionId,
    account_id: account.id,
    symbol: account.symbol,
    side: suggestion.side,
    entry_price: suggestion.entry_price,
    current_price: suggestion.entry_price, // Current price starts at entry price
    stop_loss: suggestion.stop_loss,
    take_profit: suggestion.take_profit,
    size_usd: suggestion.size_usd,
    size_qty: suggestion.size_qty,
    risk_usd: suggestion.risk_usd,
    risk_percent: suggestion.risk_percent,
    expected_rr: suggestion.expected_rr,
    invalidation_level: suggestion.invalidation_level,
    method_id: account.method_id || 'ict', // Ensure method_id is set from account
    // ICT strategy tracking
    ict_strategy: JSON.stringify(ictStrategy),
    tp_levels: JSON.stringify(tpLevels),
    tp_hit_count: 0,
    partial_closed: 0
  };

  const { createPosition, updateAccount, updatePrediction } = await import('../db/database.js');
  
  // Create position
  const position = await createPosition(db, positionData);
  
  // Update prediction with linked position (if linked)
  if (linkedPredictionId) {
    try {
      await updatePrediction(db, linkedPredictionId, {
        linked_position_id: position.id,
        outcome: 'pending'
      });
    } catch (err) {
      console.error('[PaperTrading] Failed to link prediction:', err.message);
    }
  }
  
  // Update account - in paper trading, balance stays the same, equity = balance + unrealized_pnl
  // We don't deduct from balance because the position is just allocated, not spent
  await updateAccount(db, account.id, {
    last_trade_time: new Date().toISOString()
  });

  console.log(`[PaperTrading] Opened ${suggestion.side} position for ${account.symbol}:`, {
    position_id: positionId,
    entry: suggestion.entry_price,
    sl: suggestion.stop_loss,
    tp: suggestion.take_profit,
    size_usd: suggestion.size_usd
  });

  return position;
}

/**
 * Calculate unrealized PnL for a position
 */
export function calculateUnrealizedPnL(position, currentPrice) {
  if (position.status !== 'open') {
    return { pnl: 0, pnl_percent: 0 };
  }

  if (!position.size_usd || position.size_usd === 0) {
    console.error('[PaperTrading] Invalid size_usd for position:', position.position_id, position.size_usd);
    return { pnl: 0, pnl_percent: 0 };
  }

  if (!position.size_qty || position.size_qty === 0) {
    console.error('[PaperTrading] Invalid size_qty for position:', position.position_id, position.size_qty);
    return { pnl: 0, pnl_percent: 0 };
  }

  // Add comprehensive null checks
  if (!currentPrice || currentPrice === undefined || currentPrice === null) {
    console.error('[PaperTrading] Invalid currentPrice for position:', position.position_id, currentPrice);
    return { pnl: 0, pnl_percent: 0 };
  }

  if (!position.entry_price || position.entry_price === undefined || position.entry_price === null) {
    console.error('[PaperTrading] Invalid entry_price for position:', position.position_id, position.entry_price);
    return { pnl: 0, pnl_percent: 0 };
  }

  if (!position.size_usd || position.size_usd === undefined || position.size_usd === null) {
    console.error('[PaperTrading] Invalid size_usd for position:', position.position_id, position.size_usd);
    return { pnl: 0, pnl_percent: 0 };
  }

  let pnl = 0;
  
  if (position.side === 'long') {
    pnl = (currentPrice - position.entry_price) * position.size_qty;
  } else if (position.side === 'short') {
    // short
    pnl = (position.entry_price - currentPrice) * position.size_qty;
  } else {
    console.error('[PaperTrading] Invalid position side for position:', position.position_id, position.side);
    return { pnl: 0, pnl_percent: 0 };
  }
  
  const pnl_percent = position.size_usd > 0 ? (pnl / position.size_usd) * 100 : 0;

  return { pnl, pnl_percent };
}

/**
 * Safe price comparison to handle floating point precision issues
 */
function safePriceComparison(currentPrice, targetPrice, side) {
  const epsilon = 0.001; // Small epsilon for floating point comparison
  if (side === 'long') {
    return currentPrice >= (targetPrice - epsilon);
  } else {
    return currentPrice <= (targetPrice + epsilon);
  }
}

/**
 * Check if position hit SL or any TP levels using ICT strategy
 */
export function checkStopLevels(position, currentPrice) {
  if (position.status !== 'open') {
    return { hitSL: false, hitTPs: [], nextTPLevel: null };
  }

  let hitSL = false;
  let hitTPs = [];
  let nextTPLevel = null;

  // Check stop loss
  if (position.side === 'long') {
    hitSL = currentPrice <= position.stop_loss;
  } else {
    hitSL = currentPrice >= position.stop_loss;
  }

  // Check TP levels using ICT strategy
  if (position.tp_levels) {
    let tpLevels;
    try {
      tpLevels = JSON.parse(position.tp_levels);
    } catch (error) {
      console.error('[PaperTrading] Error parsing tp_levels:', error.message);
      return { hitSL, hitTPs: [], nextTPLevel: null };
    }
    const tpHitCount = position.tp_hit_count || 0;
    
    console.log(`[PaperTrading] Checking TP levels for position ${position.position_id}:`, {
      side: position.side,
      entry_price: position.entry_price,
      current_price: currentPrice,
      tp_levels: tpLevels,
      tp_hit_count: tpHitCount,
      expected_rr: position.expected_rr,
      precision_debug: {
        entry_price_rounded: position.entry_price ? parseFloat(position.entry_price.toFixed(8)) : 'N/A',
        current_price_rounded: currentPrice ? parseFloat(currentPrice.toFixed(8)) : 'N/A',
        tp3_rounded: tpLevels[2] ? parseFloat(tpLevels[2].toFixed(8)) : 'N/A',
        price_difference: (currentPrice && tpLevels[2]) ? parseFloat((currentPrice - tpLevels[2]).toFixed(8)) : 'N/A'
      }
    });
    
    for (let i = tpHitCount; i < tpLevels.length; i++) {
      const tpLevel = tpLevels[i];
      let hitTP = false;
      
      hitTP = safePriceComparison(currentPrice, tpLevel, position.side);
      
      console.log(`[PaperTrading] TP Level ${i + 1} check:`, {
        tp_level_price: tpLevel,
        current_price: currentPrice,
        side: position.side,
        hitTP: hitTP,
        comparison: position.side === 'long' ? `${currentPrice} >= ${tpLevel}` : `${currentPrice} <= ${tpLevel}`,
        position_id: position.position_id
      });
      
      if (hitTP) {
        hitTPs.push({ level: i + 1, price: tpLevel });
        console.log(`[PaperTrading] TP Level ${i + 1} HIT at price ${tpLevel} for position ${position.position_id}`);
        
        // Force immediate TP hit logging for debugging
        console.log(`[PaperTrading] IMMEDIATE ACTION: Position ${position.position_id} hit TP${i + 1}, should trigger partial close`);
      } else {
        nextTPLevel = { level: i + 1, price: tpLevel };
        console.log(`[PaperTrading] TP Level ${i + 1} NOT HIT, next target: ${tpLevel} for position ${position.position_id}`);
        break; // Found next unhit TP level
      }
    }
  }

  return { hitSL, hitTPs, nextTPLevel };
}

/**
 * Update position PnL and current price
 */
export async function updatePositionPnL(db, position, currentPrice) {
  const { pnl, pnl_percent } = calculateUnrealizedPnL(position, currentPrice);
  const { updatePosition } = await import('../db/database.js');
  
  await updatePosition(db, position.id, {
    unrealized_pnl: pnl,
    current_price: currentPrice
  });
}

/**
 * Close partial position and update account
 */
export async function closePartialPosition(db, position, currentPrice, closeSize, closeReason) {
  const { updateAccount, logTradeEvent, getAccountBySymbol } = await import('../db/database.js');
  
  // Calculate PnL for partial close
  const { pnl, pnl_percent } = calculateUnrealizedPnL(position, currentPrice);
  const partialPnl = position.size_qty > 0 ? pnl * (closeSize / position.size_qty) : 0;
  
  // Update account balance with partial PnL
  let account;
  try {
    account = await getAccountBySymbol(db, position.symbol);
  } catch (error) {
    console.error('[PaperTrading] Error fetching account for partial close:', error.message);
    throw error;
  }
  
  if (!account) {
    console.error('[PaperTrading] Account not found for symbol:', position.symbol);
    throw new Error(`Account not found for symbol ${position.symbol}`);
  }
  
  const newBalance = account.balance + partialPnl;
  try {
    await updateAccount(db, account.id, { balance: newBalance });
  } catch (error) {
    console.error('[PaperTrading] Error updating account for partial close:', error.message);
    throw error;
  }
  
  // Create trade event for partial close
  let tradeEventData;
  try {
    tradeEventData = JSON.stringify({
      close_price: currentPrice,
      close_size: closeSize,
      close_reason: closeReason,
      pnl: partialPnl,
      pnl_percent: position.size_qty > 0 ? pnl_percent * (closeSize / position.size_qty) : 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[PaperTrading] Error stringifying trade event data:', error.message);
    tradeEventData = JSON.stringify({
      close_price: currentPrice,
      close_size: closeSize,
      close_reason: closeReason,
      pnl: partialPnl,
      pnl_percent: position.size_qty > 0 ? pnl_percent * (closeSize / position.size_qty) : 0,
      timestamp: new Date().toISOString(),
      error: 'JSON stringify error'
    });
  }
  
  await logTradeEvent(db, position.id, 'partial_close', tradeEventData);
  
  console.log(`[PaperTrading] Partial closed ${position.side} position for ${position.symbol}:`, {
    position_id: position.position_id,
    close_price: currentPrice,
    close_size: closeSize,
    close_reason: closeReason,
    partial_pnl: partialPnl?.toFixed(2) || 'N/A'
  });
  
  return { closedPosition: position, realizedPnl: partialPnl, isWin: partialPnl > 0 };
}

/**
 * Close a position and update account
 */
export async function closePosition(db, position, currentPrice, closeReason) {
  const { closePosition: closePos, updateAccount, getPosition, getPositions, updatePrediction } = await import('../db/database.js');
  
  // Calculate final PnL
  const { pnl: realizedPnl } = calculateUnrealizedPnL(position, currentPrice);
  
  // DEBUG: Log PnL calculation details
  console.log(`[PaperTrading] Closing position ${position.position_id}:`, {
    side: position.side,
    entry: position.entry_price,
    current: currentPrice,
    size_qty: position.size_qty,
    size_usd: position.size_usd,
    calculated_pnl: realizedPnl,
    reason: closeReason
  });
  
  // Close position
  await closePos(db, position.id, currentPrice, closeReason);
  
  // CRITICAL FIX: Update position with realized PnL (was missing!)
  const { updatePosition } = await import('../db/database.js');
  await updatePosition(db, position.id, {
    realized_pnl: realizedPnl,
    close_price: currentPrice
  });
  console.log(`[PaperTrading] Saved realized_pnl: ${realizedPnl?.toFixed(2) || 'N/A'} to position ${position.position_id}`);
  
  // Update linked prediction with outcome and PnL
  if (position.linked_prediction_id) {
    try {
      const outcome = realizedPnl > 0 ? 'win' : realizedPnl < 0 ? 'loss' : 'neutral';
      await updatePrediction(db, position.linked_prediction_id, {
        outcome: outcome,
        pnl: realizedPnl
      });
      console.log(`[PaperTrading] Updated prediction ${position.linked_prediction_id}: ${outcome} (${realizedPnl?.toFixed(2) || 'N/A'} USDT)`);
    } catch (err) {
      console.error('[PaperTrading] Failed to update prediction:', err.message);
    }
  }
  
  // Get updated position
  const closedPosition = await getPosition(db, position.id);
  
  // Update account
  const account = await (await import('../db/database.js')).getAccountBySymbol(db, position.symbol);
  
  // Calculate new unrealized PnL from remaining open positions
  const openPositions = await getPositions(db, { symbol: position.symbol, status: 'open' });
  const newUnrealizedPnl = openPositions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);
  
  const isWin = realizedPnl > 0;
  const isLoss = realizedPnl < 0;
  
  const newBalance = account.current_balance + realizedPnl;
  const newEquity = newBalance + newUnrealizedPnl;
  
  const updates = {
    current_balance: newBalance,
    equity: newEquity,
    unrealized_pnl: newUnrealizedPnl,
    realized_pnl: (account.realized_pnl || 0) + realizedPnl,
    total_trades: (account.total_trades || 0) + 1
  };

  if (isWin) {
    updates.winning_trades = (account.winning_trades || 0) + 1;
    updates.consecutive_losses = 0; // Reset on win
  } else if (isLoss) {
    updates.losing_trades = (account.losing_trades || 0) + 1;
    updates.consecutive_losses = (account.consecutive_losses || 0) + 1;
  }

  // Check if cooldown needed
  const { shouldEnterCooldown, cooldownUntil } = await import('./autoEntryLogic.js').then(m => 
    m.shouldEnterCooldown(account, isLoss)
  );

  if (shouldEnterCooldown) {
    updates.cooldown_until = cooldownUntil;
  }

  // Calculate max drawdown
  const peakEquity = Math.max(account.starting_balance, account.equity || account.starting_balance);
  const drawdown = ((peakEquity - newEquity) / peakEquity) * 100;
  if (drawdown > (account.max_drawdown || 0)) {
    updates.max_drawdown = drawdown;
  }

  await updateAccount(db, account.id, updates);

  console.log(`[PaperTrading] Closed ${position.side} position for ${position.symbol}:`, {
    position_id: position.position_id,
    close_price: currentPrice,
    reason: closeReason,
    pnl: realizedPnl?.toFixed(2) || 'N/A',
    is_win: isWin,
    new_balance: newBalance?.toFixed(2) || 'N/A',
    new_equity: newEquity?.toFixed(2) || 'N/A'
  });

  return { closedPosition, realizedPnl, isWin };
}

/**
 * Update all open positions for a symbol with current price
 */
export async function updateOpenPositions(db, symbol, currentPrice) {
  const { getPositions } = await import('../db/database.js');
  const openPositions = await getPositions(db, { symbol, status: 'open' });

  const results = {
    updated: 0,
    closed: [],
    errors: []
  };

  const MAX_POSITION_ITERATIONS = 1000; // Prevent infinite loops
  let iterationCount = 0;
  
  for (const position of openPositions) {
    iterationCount++;
    if (iterationCount > MAX_POSITION_ITERATIONS) {
      console.error('[PaperTrading] Maximum position iterations reached, stopping to prevent infinite loop');
      break;
    }
    
    try {
      // Check SL and TP levels using ICT strategy
      const { hitSL, hitTPs, nextTPLevel } = checkStopLevels(position, currentPrice);

      if (hitSL) {
        // Hit stop loss - close position
        const result = await closePosition(db, position, currentPrice, 'stop_loss');
        results.closed.push(result);
      } else if (hitTPs.length > 0) {
        // Handle TP hits using ICT strategy
        let ictStrategy = null;
        if (position.ict_strategy) {
          try {
            ictStrategy = JSON.parse(position.ict_strategy);
          } catch (error) {
            console.error('[PaperTrading] Error parsing ict_strategy:', error.message);
            continue; // Skip to next position
          }
        }
        
        if (ictStrategy) {
          for (const tpHit of hitTPs) {
            const strategyIndex = tpHit.level - 1;
            
            // Bounds checking for strategy arrays
            if (strategyIndex >= ictStrategy.ratios.length || strategyIndex >= ictStrategy.slMoves.length) {
              console.error(`[PaperTrading] Strategy index ${strategyIndex} out of bounds for TP level ${tpHit.level}`);
              continue;
            }
            
            const closeRatio = ictStrategy.ratios[strategyIndex];
            const slMoveIndex = ictStrategy.slMoves[strategyIndex];
            
            // Calculate position size to close
            const remainingSize = position.size_qty * (1 - (position.partial_closed || 0));
            const closeSize = remainingSize * closeRatio;
            
            // Validate position size calculations
            if (remainingSize <= 0) {
              console.error(`[PaperTrading] Invalid remaining size: ${remainingSize} for position ${position.position_id}`);
              continue;
            }
            
            if (closeSize <= 0 || closeSize > remainingSize) {
              console.error(`[PaperTrading] Invalid close size: ${closeSize} (remaining: ${remainingSize}) for position ${position.position_id}`);
              continue;
            }
            
            if (closeSize > 0) {
              // Partial close
              const result = await closePartialPosition(db, position, currentPrice, closeSize, `tp${tpHit.level}`);
              results.closed.push(result);
              
              // Update position with new size and SL if needed
              const { updatePosition } = await import('../db/database.js');
              const newSize = position.size_qty - closeSize;
              const newPartialClosed = (position.partial_closed || 0) + closeRatio;
              
              // Validate new position size
              if (newSize < 0) {
                console.error(`[PaperTrading] Invalid new size: ${newSize} for position ${position.position_id}`);
                continue;
              }
              
              if (newPartialClosed > 1) {
                console.error(`[PaperTrading] Invalid partial closed ratio: ${newPartialClosed} for position ${position.position_id}`);
                continue;
              }
              
              let newStopLoss = position.stop_loss;
              if (slMoveIndex === 0) {
                newStopLoss = position.entry_price; // Move to breakeven
              } else if (slMoveIndex > 0 && position.tp_levels) {
                try {
                  const tpLevels = JSON.parse(position.tp_levels);
                  newStopLoss = tpLevels[slMoveIndex - 1]; // Move to previous TP level
                } catch (error) {
                  console.error('[PaperTrading] Error parsing tp_levels for SL movement:', error.message);
                  newStopLoss = position.entry_price; // Fallback to breakeven
                }
              }

              // Safety check: ensure newStopLoss is defined
              if (newStopLoss === undefined || newStopLoss === null) {
                console.error(`[PaperTrading] newStopLoss is undefined for position ${position.position_id}, using entry_price as fallback`);
                newStopLoss = position.entry_price;
              }

              await updatePosition(db, position.id, {
                size_qty: newSize,
                size_usd: newSize * currentPrice,
                partial_closed: newPartialClosed,
                tp_hit_count: tpHit.level,
                stop_loss: newStopLoss,
                current_price: currentPrice
              });

              console.log(`[PaperTrading] ${symbol} position ${position.position_id} hit TP${tpHit.level}, closed ${Math.round(closeRatio * 100)}%, SL moved to ${newStopLoss?.toFixed(2) || 'N/A'}`);
            }
          }
        }
      } else {
        // Just update PnL
        await updatePositionPnL(db, position, currentPrice);
        results.updated++;
      }
    } catch (error) {
      results.errors.push({
        position_id: position.position_id,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Calculate account equity (balance + unrealized PnL)
 */
export async function calculateAccountEquity(db, account) {
  const { getPositions } = await import('../db/database.js');
  const openPositions = await getPositions(db, { account_id: account.id, status: 'open' });

  let totalUnrealizedPnL = 0;
  for (const position of openPositions) {
    totalUnrealizedPnL += position.unrealized_pnl || 0;
  }

  const equity = account.current_balance + totalUnrealizedPnL;

  // Update account
  const { updateAccount } = await import('../db/database.js');
  await updateAccount(db, account.id, {
    equity,
    unrealized_pnl: totalUnrealizedPnL
  });

  return { equity, unrealizedPnL: totalUnrealizedPnL, openPositionsCount: openPositions.length };
}

/**
 * Create account snapshot for equity curve
 */
export async function createAccountSnapshot(db, account) {
  const { createAccountSnapshot: createSnap } = await import('../db/database.js');
  
  await createSnap(
    db,
    account.id,
    account.current_balance,
    account.equity,
    account.unrealized_pnl || 0,
    await (async () => {
      const { getPositions } = await import('../db/database.js');
      const positions = await getPositions(db, { symbol: account.symbol, status: 'open' });
      return positions.length;
    })()
  );
}
