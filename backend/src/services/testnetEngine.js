/**
 * Testnet Trading Engine
 * 
 * This module handles position management for Binance Futures Testnet
 * including opening/closing positions, SL/TP management, and account sync
 */

import { 
  initTestnetClient, 
  testConnection, 
  getAccountBalance,
  getCurrentPosition,
  placeMarketOrder,
  placeStopLossOrder,
  placeTakeProfitOrder,
  cancelOrder,
  cancelAllOrders,
  getOpenOrders,
  setLeverage,
  setMarginType,
} from './binanceClient.js';
import { binanceConfig, getLeverage, getSymbol } from '../config/binance.js';
import {
  createTestnetPosition,
  getTestnetPosition,
  getTestnetPositions,
  updateTestnetPosition,
  closeTestnetPosition,
  recordTestnetTradeEvent,
  updateTestnetAccountBalance,
  updateTestnetAccountEquity,
  updateTestnetAccountStats,
  createTestnetAccountSnapshot,
} from '../db/testnetDatabase.js';

// Global client instance
let testnetClient = null;

/**
 * Initialize testnet client on startup
 */
export async function initTestnetEngine() {
  if (!binanceConfig.enabled) {
    console.log('[TestnetEngine] Testnet is disabled, skipping initialization');
    return null;
  }

  testnetClient = initTestnetClient();
  
  if (!testnetClient) {
    console.error('[TestnetEngine] Failed to initialize testnet client');
    return null;
  }

  // Test connection
  const connectionTest = await testConnection(testnetClient);
  if (!connectionTest.success) {
    console.error('[TestnetEngine] Connection test failed:', connectionTest.error);
    return null;
  }

  // Set leverage for the symbol (optional - skip if fails)
  try {
    await setLeverage(testnetClient, getSymbol(), getLeverage());
    console.log('[TestnetEngine] Leverage configured');
  } catch (error) {
    console.warn('[TestnetEngine] Failed to set leverage (continuing without it):', error.message);
  }

  // Set margin type (optional - skip if fails)
  try {
    await setMarginType(testnetClient, getSymbol(), 'ISOLATED');
    console.log('[TestnetEngine] Margin type configured');
  } catch (error) {
    console.warn('[TestnetEngine] Failed to set margin type (continuing without it):', error.message);
  }

  return testnetClient;
}

/**
 * Open testnet position
 */
export async function openTestnetPosition(db, account, positionData, predictionId, methodId) {
  if (!testnetClient) {
    console.error('[TestnetEngine] Testnet client not initialized');
    throw new Error('Testnet client not initialized');
  }

  const {
    side,
    entry_price,
    stop_loss,
    take_profit,
    size_usd,
    risk_usd,
    risk_percent,
    expected_rr,
  } = positionData;

  const symbol = getSymbol();
  const leverage = getLeverage();
  
  // Calculate quantity based on size_usd and leverage
  const size_qty = size_usd / entry_price;
  
  // Validate position size vs account balance
  if (size_usd > account.current_balance) {
    console.error(`[TestnetEngine] Position size ${size_usd} exceeds account balance ${account.current_balance}`);
    throw new Error('Position size exceeds account balance');
  }

  // Check cooldown
  if (account.cooldown_until && new Date(account.cooldown_until) > new Date()) {
    console.log('[TestnetEngine] Account is in cooldown, skipping position open');
    return null;
  }

  try {
    // Record event: position opening started
    const positionId = `testnet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Place market order
    const order = await placeMarketOrder(testnetClient, symbol, side, size_qty);
    
    // Place SL order (opposite side)
    const slSide = side === 'BUY' ? 'SELL' : 'BUY';
    const slOrder = await placeStopLossOrder(testnetClient, symbol, slSide, size_qty, stop_loss);
    
    // Place TP order (opposite side)
    const tpOrder = await placeTakeProfitOrder(testnetClient, symbol, slSide, size_qty, take_profit);
    
    // Save position to database
    const newPosition = await createTestnetPosition(db, {
      position_id: positionId,
      account_id: account.id,
      symbol: symbol,
      side: side,
      entry_price: entry_price,
      stop_loss: stop_loss,
      take_profit: take_profit,
      size_usd: size_usd,
      size_qty: size_qty,
      risk_usd: risk_usd,
      risk_percent: risk_percent,
      expected_rr: expected_rr,
      linked_prediction_id: predictionId,
      binance_order_id: order.orderId.toString(),
      binance_sl_order_id: slOrder.orderId.toString(),
      binance_tp_order_id: tpOrder.orderId.toString(),
    });
    
    // Record trade event
    await recordTestnetTradeEvent(db, positionId, 'position_opened', {
      order_id: order.orderId,
      sl_order_id: slOrder.orderId,
      tp_order_id: tpOrder.orderId,
      entry_price: entry_price,
      size_qty: size_qty,
    });
    
    console.log(`[TestnetEngine] Opened testnet position: ${positionId} (${side} ${symbol} @ ${entry_price})`);
    
    return newPosition;
  } catch (error) {
    console.error('[TestnetEngine] Failed to open testnet position:', error.message);
    
    // Record event: position open failed
    await recordTestnetTradeEvent(db, positionId, 'position_open_failed', {
      error: error.message,
    });
    
    throw error;
  }
}

/**
 * Close testnet position
 */
export async function closeTestnetPositionEngine(db, position, currentPrice, closeReason) {
  if (!testnetClient) {
    console.error('[TestnetEngine] Testnet client not initialized');
    throw new Error('Testnet client not initialized');
  }

  try {
    // Cancel SL/TP orders
    if (position.binance_sl_order_id) {
      try {
        await cancelOrder(testnetClient, position.symbol, position.binance_sl_order_id);
      } catch (error) {
        console.error('[TestnetEngine] Failed to cancel SL order:', error.message);
      }
    }
    
    if (position.binance_tp_order_id) {
      try {
        await cancelOrder(testnetClient, position.symbol, position.binance_tp_order_id);
      } catch (error) {
        console.error('[TestnetEngine] Failed to cancel TP order:', error.message);
      }
    }
    
    // Place opposite market order to close
    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    const closeOrder = await placeMarketOrder(testnetClient, position.symbol, closeSide, position.size_qty);
    
    // Calculate realized PnL
    const priceDiff = closeSide === 'SELL' 
      ? currentPrice - position.entry_price 
      : position.entry_price - currentPrice;
    
    const realizedPnl = priceDiff * position.size_qty;
    const isWin = realizedPnl > 0;
    
    // Update position status
    await closeTestnetPosition(db, position.position_id, currentPrice, closeReason);
    await updateTestnetPosition(db, position.position_id, {
      realized_pnl: realizedPnl,
      close_price: currentPrice,
    });
    
    // Update account balance
    const newBalance = position.account_id ? await getAccountBalance(testnetClient) : null;
    if (newBalance) {
      await updateTestnetAccountBalance(db, position.account_id, newBalance.availableBalance, realizedPnl);
    }
    
    // Update account stats
    await updateTestnetAccountStats(db, position.account_id, isWin);
    
    // Record trade event
    await recordTestnetTradeEvent(db, position.position_id, 'position_closed', {
      close_price: currentPrice,
      realized_pnl: realizedPnl,
      close_reason: closeReason,
      close_order_id: closeOrder.orderId,
    });
    
    console.log(`[TestnetEngine] Closed testnet position ${position.position_id} at ${currentPrice} (${closeReason}), PnL: ${realizedPnl.toFixed(2)}`);
    
    return { realizedPnl, isWin };
  } catch (error) {
    console.error('[TestnetEngine] Failed to close testnet position:', error.message);
    throw error;
  }
}

/**
 * Update testnet position stop loss
 */
export async function updateTestnetPositionSL(db, position, newSL, reason) {
  if (!testnetClient) {
    console.error('[TestnetEngine] Testnet client not initialized');
    throw new Error('Testnet client not initialized');
  }

  try {
    // Cancel existing SL order
    if (position.binance_sl_order_id) {
      await cancelOrder(testnetClient, position.symbol, position.binance_sl_order_id);
    }
    
    // Place new SL order
    const slSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    const newSLOrder = await placeStopLossOrder(testnetClient, position.symbol, slSide, position.size_qty, newSL);
    
    // Update database
    await updateTestnetPosition(db, position.position_id, {
      stop_loss: newSL,
      binance_sl_order_id: newSLOrder.orderId.toString(),
    });
    
    // Record trade event
    await recordTestnetTradeEvent(db, position.position_id, 'sl_updated', {
      old_sl: position.stop_loss,
      new_sl: newSL,
      reason: reason,
      new_sl_order_id: newSLOrder.orderId,
    });
    
    console.log(`[TestnetEngine] Updated SL for position ${position.position_id}: ${position.stop_loss} -> ${newSL} (${reason})`);
  } catch (error) {
    console.error('[TestnetEngine] Failed to update SL:', error.message);
    throw error;
  }
}

/**
 * Check if SL/TP is hit based on current price
 * Supports partial TP levels if tp_levels is defined
 */
export async function checkTestnetSLTP(db, position, currentPrice) {
  if (position.status !== 'open') {
    return null;
  }

  const isLong = position.side === 'BUY';
  
  // Check SL hit
  const slHit = isLong ? currentPrice <= position.stop_loss : currentPrice >= position.stop_loss;
  
  if (slHit) {
    console.log(`[TestnetEngine] SL hit for position ${position.position_id} at ${currentPrice}`);
    await closeTestnetPositionEngine(db, position, currentPrice, 'stop_loss');
    return 'stop_loss';
  }
  
  // Check TP levels (partial TP support)
  if (position.tp_levels) {
    let tpLevels;
    try {
      tpLevels = JSON.parse(position.tp_levels);
    } catch (error) {
      console.error('[TestnetEngine] Error parsing tp_levels:', error.message);
      // Fallback to simple TP
      const tpHit = isLong ? currentPrice >= position.take_profit : currentPrice <= position.take_profit;
      if (tpHit) {
        console.log(`[TestnetEngine] Simple TP hit for position ${position.position_id} at ${currentPrice}`);
        await closeTestnetPositionEngine(db, position, currentPrice, 'take_profit');
        return 'take_profit';
      }
      return null;
    }
    
    const tpHitCount = position.tp_hit_count || 0;
    
    // Check each TP level starting from the current hit count
    for (let i = tpHitCount; i < tpLevels.length; i++) {
      const tpLevel = tpLevels[i];
      const tpHit = isLong ? currentPrice >= tpLevel : currentPrice <= tpLevel;
      
      if (tpHit) {
        console.log(`[TestnetEngine] TP Level ${i + 1} hit for position ${position.position_id} at ${currentPrice} (target: ${tpLevel})`);
        
        // Handle partial close
        const result = await handlePartialTP(db, position, currentPrice, i + 1, tpLevels.length);
        
        // Update TP hit count
        await updateTestnetPosition(db, position.position_id, {
          tp_hit_count: i + 1,
        });
        
        // If this was the last TP level, close the remaining position
        if (i + 1 === tpLevels.length) {
          await closeTestnetPositionEngine(db, position, currentPrice, 'take_profit_final');
          return 'take_profit_final';
        }
        
        return `partial_tp_${i + 1}`;
      }
    }
  } else {
    // Fallback: Check simple take_profit for non-ICT methods
    const tpHit = isLong ? currentPrice >= position.take_profit : currentPrice <= position.take_profit;
    
    if (tpHit) {
      console.log(`[TestnetEngine] Simple TP hit for position ${position.position_id} at ${currentPrice}`);
      await closeTestnetPositionEngine(db, position, currentPrice, 'take_profit');
      return 'take_profit';
    }
  }
  
  return null;
}

/**
 * Handle partial TP close on Binance
 * Cancels existing TP order, places partial close order, updates remaining TP
 */
async function handlePartialTP(db, position, currentPrice, tpLevel, totalTPLevels) {
  if (!testnetClient) {
    console.error('[TestnetEngine] Testnet client not initialized');
    throw new Error('Testnet client not initialized');
  }

  try {
    const symbol = getSymbol();
    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    
    // Calculate partial close ratio (e.g., 50% for 2 TP levels, 33% for 3 TP levels)
    const closeRatio = 1 / totalTPLevels;
    const closeQty = position.size_qty * closeRatio;
    
    // Cancel existing TP order
    if (position.binance_tp_order_id) {
      try {
        await cancelOrder(testnetClient, symbol, position.binance_tp_order_id);
        console.log(`[TestnetEngine] Cancelled TP order ${position.binance_tp_order_id} for partial close`);
      } catch (error) {
        console.error('[TestnetEngine] Failed to cancel TP order:', error.message);
      }
    }
    
    // Place partial close market order
    const closeOrder = await placeMarketOrder(testnetClient, symbol, closeSide, closeQty);
    
    // Calculate partial PnL
    const priceDiff = closeSide === 'SELL' 
      ? currentPrice - position.entry_price 
      : position.entry_price - currentPrice;
    const partialPnl = priceDiff * closeQty;
    
    // Update position
    const newPartialClosed = (position.partial_closed || 0) + closeQty;
    const remainingQty = position.size_qty - newPartialClosed;
    
    await updateTestnetPosition(db, position.position_id, {
      partial_closed: newPartialClosed,
      size_qty: remainingQty,
      unrealized_pnl: partialPnl, // Update with partial PnL
    });
    
    // Update account balance with partial PnL
    await updateTestnetAccountBalance(db, position.account_id, null, partialPnl);
    
    // If there's remaining position, place new TP order for the remaining quantity
    if (remainingQty > 0.001) {
      const newTPOrder = await placeTakeProfitOrder(testnetClient, symbol, closeSide, remainingQty, position.take_profit);
      await updateTestnetPosition(db, position.position_id, {
        binance_tp_order_id: newTPOrder.orderId.toString(),
      });
      console.log(`[TestnetEngine] Placed new TP order for remaining ${remainingQty} qty`);
    }
    
    // Record trade event
    await recordTestnetTradeEvent(db, position.position_id, 'partial_tp_hit', {
      tp_level: tpLevel,
      close_qty: closeQty,
      close_price: currentPrice,
      partial_pnl: partialPnl,
      close_order_id: closeOrder.orderId,
    });
    
    console.log(`[TestnetEngine] Partial TP ${tpLevel} executed for position ${position.position_id}: closed ${closeQty} @ ${currentPrice}, PnL: ${partialPnl.toFixed(2)}`);
    
    return { partialPnl, closeQty };
  } catch (error) {
    console.error('[TestnetEngine] Failed to handle partial TP:', error.message);
    throw error;
  }
}

/**
 * Sync testnet account with Binance
 * Detects discrepancies between database and Binance, auto-corrects when possible
 */
export async function syncTestnetAccount(db, account) {
  if (!testnetClient) {
    console.error('[TestnetEngine] Testnet client not initialized');
    return null;
  }

  try {
    // Fetch real balance from Binance
    const balance = await getAccountBalance(testnetClient);
    
    // Detect discrepancies
    const balanceDiff = Math.abs(balance.availableBalance - account.current_balance);
    const equityDiff = Math.abs(balance.totalWalletBalance - account.equity);
    
    if (balanceDiff > 0.01 || equityDiff > 0.01) {
      console.warn(`[TestnetEngine] Balance discrepancy detected for account ${account.id}:`);
      console.warn(`  DB balance: ${account.current_balance}, Binance balance: ${balance.availableBalance} (diff: ${balanceDiff.toFixed(2)})`);
      console.warn(`  DB equity: ${account.equity}, Binance equity: ${balance.totalWalletBalance} (diff: ${equityDiff.toFixed(2)})`);
      
      // Auto-correct: update database with Binance values
      await updateTestnetAccountBalance(db, account.id, balance.availableBalance, 0);
      await updateTestnetAccountEquity(db, account.id, balance.totalUnrealizedProfit);
      
      // Record sync event
      await recordTestnetTradeEvent(db, `account_${account.id}`, 'balance_sync', {
        old_balance: account.current_balance,
        new_balance: balance.availableBalance,
        old_equity: account.equity,
        new_equity: balance.totalWalletBalance,
        reason: 'discrepancy_detected',
      });
      
      console.log(`[TestnetEngine] Auto-corrected account ${account.id} with Binance values`);
    } else {
      // No discrepancy, just update equity with latest unrealized PnL
      await updateTestnetAccountEquity(db, account.id, balance.totalUnrealizedProfit);
    }
    
    // Sync positions with Binance
    await syncTestnetPositions(db, account);
    
    // Create snapshot
    await createTestnetAccountSnapshot(db, account.id);
    
    console.log(`[TestnetEngine] Synced testnet account ${account.id}: balance=${balance.availableBalance}, equity=${balance.totalWalletBalance}`);
    
    return balance;
  } catch (error) {
    console.error('[TestnetEngine] Failed to sync testnet account:', error.message);
    
    // Record sync failure event
    await recordTestnetTradeEvent(db, `account_${account.id}`, 'sync_failed', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    
    throw error;
  }
}

/**
 * Sync testnet positions with Binance
 * Tracks order status for SL/TP orders and detects discrepancies
 */
async function syncTestnetPositions(db, account) {
  if (!testnetClient) {
    return;
  }

  try {
    const symbol = getSymbol();
    
    // Get open orders from Binance
    const binanceOrders = await getOpenOrders(testnetClient, symbol);
    
    // Get open positions from database
    const dbPositions = await getTestnetPositions(db, { account_id: account.id, status: 'open' });
    
    for (const position of dbPositions) {
      // Check SL order status
      if (position.binance_sl_order_id) {
        const slOrder = binanceOrders.find(o => o.orderId.toString() === position.binance_sl_order_id);
        
        if (!slOrder) {
          // SL order not found on Binance - might have been filled or cancelled
          console.warn(`[TestnetEngine] SL order ${position.binance_sl_order_id} not found on Binance for position ${position.position_id}`);
          
          // Record order status event
          await recordTestnetTradeEvent(db, position.position_id, 'sl_order_missing', {
            order_id: position.binance_sl_order_id,
            reason: 'order_not_found_on_binance',
          });
          
          // Re-place SL order if position is still open
          try {
            const slSide = position.side === 'BUY' ? 'SELL' : 'BUY';
            const newSLOrder = await placeStopLossOrder(testnetClient, symbol, slSide, position.size_qty, position.stop_loss);
            
            await updateTestnetPosition(db, position.position_id, {
              binance_sl_order_id: newSLOrder.orderId.toString(),
            });
            
            await recordTestnetTradeEvent(db, position.position_id, 'sl_order_replaced', {
              old_order_id: position.binance_sl_order_id,
              new_order_id: newSLOrder.orderId,
              reason: 'order_missing',
            });
            
            console.log(`[TestnetEngine] Replaced SL order for position ${position.position_id}`);
          } catch (replaceError) {
            console.error(`[TestnetEngine] Failed to replace SL order:`, replaceError.message);
          }
        } else if (slOrder.status === 'FILLED') {
          // SL order was filled - position should be closed
          console.log(`[TestnetEngine] SL order ${position.binance_sl_order_id} was filled for position ${position.position_id}`);
          
          // Check if position is still open in database
          if (position.status === 'open') {
            await closeTestnetPositionEngine(db, position, position.stop_loss, 'stop_loss_filled');
          }
        }
      }
      
      // Check TP order status
      if (position.binance_tp_order_id) {
        const tpOrder = binanceOrders.find(o => o.orderId.toString() === position.binance_tp_order_id);
        
        if (!tpOrder) {
          // TP order not found on Binance
          console.warn(`[TestnetEngine] TP order ${position.binance_tp_order_id} not found on Binance for position ${position.position_id}`);
          
          await recordTestnetTradeEvent(db, position.position_id, 'tp_order_missing', {
            order_id: position.binance_tp_order_id,
            reason: 'order_not_found_on_binance',
          });
          
          // Re-place TP order if position is still open
          try {
            const tpSide = position.side === 'BUY' ? 'SELL' : 'BUY';
            const newTPOrder = await placeTakeProfitOrder(testnetClient, symbol, tpSide, position.size_qty, position.take_profit);
            
            await updateTestnetPosition(db, position.position_id, {
              binance_tp_order_id: newTPOrder.orderId.toString(),
            });
            
            await recordTestnetTradeEvent(db, position.position_id, 'tp_order_replaced', {
              old_order_id: position.binance_tp_order_id,
              new_order_id: newTPOrder.orderId,
              reason: 'order_missing',
            });
            
            console.log(`[TestnetEngine] Replaced TP order for position ${position.position_id}`);
          } catch (replaceError) {
            console.error(`[TestnetEngine] Failed to replace TP order:`, replaceError.message);
          }
        } else if (tpOrder.status === 'FILLED') {
          // TP order was filled - position should be closed
          console.log(`[TestnetEngine] TP order ${position.binance_tp_order_id} was filled for position ${position.position_id}`);
          
          if (position.status === 'open') {
            await closeTestnetPositionEngine(db, position, position.take_profit, 'take_profit_filled');
          }
        }
      }
    }
    
    console.log(`[TestnetEngine] Synced ${dbPositions.length} testnet positions with Binance`);
  } catch (error) {
    console.error('[TestnetEngine] Failed to sync testnet positions:', error.message);
  }
}

/**
 * Update unrealized PnL for open testnet positions
 */
export async function updateTestnetPositionsPnL(db, currentPrice) {
  if (!testnetClient) {
    return;
  }

  try {
    // Get all open positions
    const openPositions = await getTestnetPositions(db, { status: 'open' });
    
    for (const position of openPositions) {
      const isLong = position.side === 'BUY';
      const priceDiff = isLong 
        ? currentPrice - position.entry_price 
        : position.entry_price - currentPrice;
      
      const unrealizedPnl = priceDiff * position.size_qty;
      
      // Update position
      await updateTestnetPosition(db, position.position_id, {
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
      });
      
      // Check SL/TP
      await checkTestnetSLTP(db, { ...position, current_price: currentPrice, unrealized_pnl: unrealizedPnl }, currentPrice);
    }
    
    // Update account equity
    const accounts = await getTestnetAccounts(db);
    for (const account of accounts) {
      const accountPositions = openPositions.filter(p => p.account_id === account.id);
      const totalUnrealizedPnl = accountPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
      await updateTestnetAccountEquity(db, account.id, totalUnrealizedPnl);
    }
  } catch (error) {
    console.error('[TestnetEngine] Failed to update positions PnL:', error.message);
  }
}

/**
 * Get all testnet accounts
 */
async function getTestnetAccounts(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM testnet_accounts', (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

/**
 * Get testnet client instance
 */
export function getTestnetClient() {
  return testnetClient;
}
