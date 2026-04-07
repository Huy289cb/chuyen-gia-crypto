// Paper Trading Engine
// Manages positions, calculates PnL, handles SL/TP, and account updates

import { randomUUID } from 'crypto';

const PAPER_TRADING_CONFIG = {
  partialTPEnabled: true,
  partialTPRatios: [0.5, 0.5],
  partialTPRRLevels: [1.0, 2.0],
  trailingStopEnabled: true,
  trailAfterRR: 1.0,
  trailDistancePct: 0.5
};

/**
 * Calculate TP1 and TP2 levels based on R:R ratios
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
  
  const positionData = {
    position_id: positionId,
    account_id: account.id,
    symbol: account.symbol,
    side: suggestion.side,
    entry_price: suggestion.entry_price,
    stop_loss: suggestion.stop_loss,
    take_profit: suggestion.take_profit,
    size_usd: suggestion.size_usd,
    size_qty: suggestion.size_qty,
    risk_usd: suggestion.risk_usd,
    risk_percent: suggestion.risk_percent,
    expected_rr: suggestion.expected_rr,
    linked_prediction_id: linkedPredictionId
  };

  const { createPosition, updateAccount } = await import('../db/database.js');
  
  // Create position
  const position = await createPosition(db, positionData);
  
  // Update account - in paper trading, balance stays the same, equity = balance + unrealized_pnl
  // We don't deduct from balance because the position is just allocated, not spent
  await updateAccount(db, account.id, {
    total_trades: (account.total_trades || 0) + 1,
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

  let pnl = 0;
  
  if (position.side === 'long') {
    pnl = (currentPrice - position.entry_price) * position.size_qty;
  } else {
    // short
    pnl = (position.entry_price - currentPrice) * position.size_qty;
  }

  const pnl_percent = (pnl / position.size_usd) * 100;

  return { pnl, pnl_percent };
}

/**
 * Check if position hit SL, TP1, or TP2
 */
export function checkStopLevels(position, currentPrice) {
  if (position.status !== 'open') {
    return { hitSL: false, hitTP1: false, hitTP2: false };
  }

  let hitSL = false;
  let hitTP1 = false;
  let hitTP2 = false;

  if (position.side === 'long') {
    hitSL = currentPrice <= position.stop_loss;
    // Calculate TP1/TP2 if not already stored
    const tpLevels = calculateTPLevels(position.entry_price, position.stop_loss, PAPER_TRADING_CONFIG.partialTPRRLevels);
    hitTP1 = currentPrice >= tpLevels.tp1;
    hitTP2 = currentPrice >= tpLevels.tp2;
  } else {
    // short
    hitSL = currentPrice >= position.stop_loss;
    const tpLevels = calculateTPLevels(position.entry_price, position.stop_loss, PAPER_TRADING_CONFIG.partialTPRRLevels);
    hitTP1 = currentPrice <= tpLevels.tp1;
    hitTP2 = currentPrice <= tpLevels.tp2;
  }

  return { hitSL, hitTP1, hitTP2 };
}

/**
 * Update position PnL based on current price
 */
export async function updatePositionPnL(db, position, currentPrice) {
  const { pnl, pnl_percent } = calculateUnrealizedPnL(position, currentPrice);
  const { updatePosition } = await import('../db/database.js');
  
  await updatePosition(db, position.id, {
    unrealized_pnl: pnl
  });

  return { pnl, pnl_percent };
}

/**
 * Close position and update account
 */
export async function closePosition(db, position, currentPrice, closeReason) {
  const { closePosition: closePos, updateAccount, getPosition, getPositions } = await import('../db/database.js');
  
  // Calculate final PnL
  const { pnl: realizedPnl } = calculateUnrealizedPnL(position, currentPrice);
  
  // Close position
  await closePos(db, position.id, currentPrice, closeReason);
  
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
    realized_pnl: (account.realized_pnl || 0) + realizedPnl
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
    pnl: realizedPnl.toFixed(2),
    is_win: isWin,
    new_balance: newBalance.toFixed(2),
    new_equity: newEquity.toFixed(2)
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

  for (const position of openPositions) {
    try {
      // Check SL, TP1, TP2
      const { hitSL, hitTP1, hitTP2 } = checkStopLevels(position, currentPrice);

      if (hitSL) {
        // Hit stop loss - close position
        const result = await closePosition(db, position, currentPrice, 'stop_loss');
        results.closed.push(result);
      } else if (hitTP2 || (position.take_profit && 
           (position.side === 'long' ? currentPrice >= position.take_profit : currentPrice <= position.take_profit))) {
        // Hit TP2 or original TP - close position
        const result = await closePosition(db, position, currentPrice, 'take_profit');
        results.closed.push(result);
      } else if (hitTP1 && PAPER_TRADING_CONFIG.trailingStopEnabled) {
        // Hit TP1 - move SL to breakeven (trailing stop)
        const { updatePosition } = await import('../db/database.js');
        await updatePosition(db, position.id, {
          stop_loss: position.entry_price, // Move to breakeven
          tp1_hit: true
        });
        console.log(`[PaperTrading] ${symbol} position ${position.position_id} hit TP1, SL moved to breakeven`);
        results.updated++;
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
  const openPositions = await getPositions(db, { symbol: account.symbol, status: 'open' });

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
