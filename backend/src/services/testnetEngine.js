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
  placeLimitOrder,
  placeStopLossOrder,
  placeTakeProfitOrder,
  cancelOrder,
  cancelAllOrders,
  getOpenOrders,
  setLeverage,
  setMarginType,
} from './binanceClient.js';
import { setPositionMode } from './binance/trading.js';
import { binanceConfig, getLeverage, getSymbol, validateConfig } from '../config/binance.js';
import {
  createTestnetPosition,
  getTestnetPosition,
  getTestnetPositions,
  updateTestnetPosition,
  closeTestnetPosition,
  recordTestnetTradeEvent,
  updateTestnetAccountBalance,
  updateTestnetAccountEquity,
  updateTestnetAccountEquityDirect,
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
    console.error('[TestnetEngine] Failed to set leverage: Invalid API-key permissions. Please enable "Enable Futures" for your API key.', error.message);
    return null; // Stop initialization if futures permissions are missing
  }

  // Set margin type (optional - skip if fails or already set)
  try {
    await setMarginType(testnetClient, getSymbol(), 'ISOLATED');
    console.log('[TestnetEngine] Margin type configured');
  } catch (error) {
    // Ignore "No need to change margin type" error - it means margin type is already correct
    if (error.message.includes('No need to change margin type')) {
      console.log('[TestnetEngine] Margin type already set correctly');
    } else {
      console.error('[TestnetEngine] Failed to set margin type: Invalid API-key permissions. Please enable "Enable Futures" for your API key.', error.message);
      return null; // Stop initialization if futures permissions are missing
    }
  }

  // Set position mode to dual (hedge mode) - allows both LONG and SHORT positions simultaneously
  try {
    await setPositionMode(true);
    console.log('[TestnetEngine] Position mode set to dual (hedge mode)');
  } catch (error) {
    // Ignore if already set (error -4059 or message contains specific text)
    if (error.message.includes('No need to change position side') || error.message.includes('-4059')) {
      console.log('[TestnetEngine] Position mode already set to dual');
    } else {
      console.error('[TestnetEngine] Failed to set position mode:', error.message);
      // Continue anyway - might already be set
    }
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
    maxVolumePerAccount = 2000,
  } = positionData;

  const symbol = getSymbol();
  const leverage = getLeverage();

  // Cap position size to maxVolumePerAccount (from method config, default 2000)
  const maxOrderSize = maxVolumePerAccount;
  let cappedSizeUsd = size_usd;
  let cappedSizeQty = size_usd / entry_price;

  if (size_usd > maxOrderSize) {
    console.log(`[TestnetEngine] Position size $${size_usd.toFixed(2)} exceeds max $${maxOrderSize}, capping to $${maxOrderSize}`);
    cappedSizeUsd = maxOrderSize;
    cappedSizeQty = maxOrderSize / entry_price;
  }

  // Calculate quantity based on capped size_usd and leverage
  const size_qty = cappedSizeQty;

  // Round quantity to Binance precision (BTCUSDT stepSize is 0.001)
  const QUANTITY_PRECISION = 3; // 3 decimal places for BTCUSDT
  const roundedQty = Math.floor(size_qty * Math.pow(10, QUANTITY_PRECISION)) / Math.pow(10, QUANTITY_PRECISION);
  
  // Ensure minimum quantity (Binance minimum for BTCUSDT is 0.001)
  const finalQty = Math.max(roundedQty, 0.001);
  
  console.log(`[TestnetEngine] Quantity calculation: size_usd=${cappedSizeUsd}, entry_price=${entry_price}, raw_qty=${size_qty}, rounded_qty=${finalQty}`);

  // Validate position size vs account balance
  if (cappedSizeUsd > account.current_balance) {
    console.error(`[TestnetEngine] Position size ${cappedSizeUsd} exceeds account balance ${account.current_balance}`);
    throw new Error('Position size exceeds account balance');
  }

  // Check cooldown
  if (account.cooldown_until && new Date(account.cooldown_until) > new Date()) {
    console.log('[TestnetEngine] Account is in cooldown, skipping position open');
    return null;
  }

  // Generate positionId before try block for error handling
  const positionId = `testnet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Record event: position opening started
    
    // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
    const binanceSide = side === 'long' ? 'BUY' : 'SELL';
    
    // Convert internal side to positionSide for hedge mode (LONG/SHORT)
    const positionSide = side === 'long' ? 'LONG' : 'SHORT';
    
    // Place market order
    const order = await placeMarketOrder(testnetClient, symbol, binanceSide, finalQty, positionSide);
    
    // Place SL order (opposite side) using Algo Order API for hedge mode
    const slSide = binanceSide === 'BUY' ? 'SELL' : 'BUY';
    const slOrder = await placeStopLossOrder(testnetClient, symbol, slSide, finalQty, stop_loss, positionSide);
    
    // Place TP order (opposite side) using Algo Order API for hedge mode
    const tpOrder = await placeTakeProfitOrder(testnetClient, symbol, slSide, finalQty, take_profit, positionSide);
    
    // Save position to database (SL/TP now managed via Binance Algo Orders)
    const newPosition = await createTestnetPosition(db, {
      position_id: positionId,
      account_id: account.id,
      symbol: symbol,
      side: side,
      entry_price: entry_price,
      stop_loss: stop_loss,
      take_profit: take_profit,
      size_usd: cappedSizeUsd,
      size_qty: finalQty,
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
      size_qty: finalQty,
    });
    
    console.log(`[TestnetEngine] Opened testnet position: ${positionId} (${side} ${symbol} @ ${entry_price})`);

    // After opening position, check if we need to cancel pending orders
    // Market orders may have filled the volume limit
    try {
      const { getTestnetPendingOrders, cancelTestnetPendingOrder } = await import('../db/testnetDatabase.js');

      // Get current open positions volume after opening this position
      const { getTestnetPositions } = await import('../db/testnetDatabase.js');
      const updatedOpenPositions = await getTestnetPositions(db, { symbol: symbol, method_id: methodId, status: 'open' });
      const totalOpenVolume = updatedOpenPositions.reduce((sum, pos) => sum + (pos.size_usd || 0), 0);

      // Get pending orders for this symbol and method
      const pendingOrders = await getTestnetPendingOrders(db, { symbol: symbol, method_id: methodId, status: 'pending' });

      if (pendingOrders.length > 0) {
        const maxVolume = positionData.maxVolumePerAccount || 2000;

        // Calculate total pending volume
        const totalPendingVolume = pendingOrders.reduce((sum, order) => sum + (order.size_usd || 0), 0);
        const totalVolume = totalOpenVolume + totalPendingVolume;

        // If market volume already at limit, cancel all pending orders
        if (totalOpenVolume >= maxVolume) {
          console.log(`[TestnetEngine] Cancelling all pending orders for ${symbol}/${methodId}: market volume $${totalOpenVolume.toFixed(2)} already at limit $${maxVolume}`);
          for (const order of pendingOrders) {
            await cancelTestnetPendingOrder(db, order.order_id, 'volume_limit_reached', order.binance_order_id);
            console.log(`[TestnetEngine] Cancelled pending order ${order.order_id} due to volume limit`);
          }
        }
        // If market + pending would exceed limit, cancel pending orders
        else if (totalVolume > maxVolume) {
          console.log(`[TestnetEngine] Cancelling all pending orders for ${symbol}/${methodId}: market ($${totalOpenVolume.toFixed(2)}) + pending ($${totalPendingVolume.toFixed(2)}) would exceed limit $${maxVolume}`);
          for (const order of pendingOrders) {
            await cancelTestnetPendingOrder(db, order.order_id, 'volume_limit_reached', order.binance_order_id);
            console.log(`[TestnetEngine] Cancelled pending order ${order.order_id} due to volume limit`);
          }
        }
        // If total volume still under limit, keep pending orders
        else {
          console.log(`[TestnetEngine] Keeping ${pendingOrders.length} pending orders for ${symbol}/${methodId}: total volume $${totalVolume.toFixed(2)} <= $${maxVolume}`);
        }
      }
    } catch (error) {
      console.error('[TestnetEngine] Error checking/cancelling pending orders after opening position:', error.message);
      // Don't throw error, position was successfully opened
    }

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
    // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
    const binanceSide = position.side === 'long' ? 'BUY' : 'SELL';
    const closeSide = binanceSide === 'BUY' ? 'SELL' : 'BUY';
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
    
    console.log(`[TestnetEngine] Closed testnet position ${position.position_id} at ${currentPrice} (${closeReason}), PnL: ${realizedPnl?.toFixed(2) || 'N/A'}`);
    
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
    // SL managed internally in hedge mode - no Binance order placement
    // Just update database
    await updateTestnetPosition(db, position.position_id, {
      stop_loss: newSL,
      binance_sl_order_id: null, // SL managed internally
    });
    
    // Record trade event
    await recordTestnetTradeEvent(db, position.position_id, 'sl_updated', {
      old_sl: position.stop_loss,
      new_sl: newSL,
      reason: reason,
    });
    
    console.log(`[TestnetEngine] Updated SL for position ${position.position_id}: ${position.stop_loss} -> ${newSL} (${reason}) - managed internally (hedge mode)`);
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

  const isLong = position.side === 'long';
  
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
    // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
    const binanceSide = position.side === 'long' ? 'BUY' : 'SELL';
    const closeSide = binanceSide === 'BUY' ? 'SELL' : 'BUY';
    
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
    
    // If there's remaining position, place new TP order using Algo Order API
    if (remainingQty > 0.001) {
      const positionSide = position.side === 'long' ? 'LONG' : 'SHORT';
      const newTPOrder = await placeTakeProfitOrder(testnetClient, symbol, closeSide, remainingQty, position.take_profit, positionSide);
      
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
    
    console.log(`[TestnetEngine] Partial TP ${tpLevel} executed for position ${position.position_id}: closed ${closeQty} @ ${currentPrice}, PnL: ${partialPnl?.toFixed(2) || 'N/A'}`);
    
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
    // Use availableBalance for balance comparison (USDT only)
    // Use totalWalletBalance for equity comparison (includes unrealized PnL)
    const balanceDiff = Math.abs(balance.availableBalance - account.current_balance);
    const equityDiff = Math.abs(balance.totalWalletBalance - account.equity);

    // Skip auto-correction if Binance balance is 0 (unfunded testnet account)
    // Keep DB balance for paper trading
    if (balance.availableBalance < 1) {
      console.log(`[TestnetEngine] Binance balance is ${balance.availableBalance} (unfunded), keeping DB balance ${account.current_balance} for paper trading`);
      // Still update equity with unrealized PnL from positions (if any)
      await updateTestnetAccountEquity(db, account.id, balance.totalUnrealizedProfit);
    } else if (balanceDiff > 0.01 || equityDiff > 0.01) {
      console.warn(`[TestnetEngine] Balance discrepancy detected for account ${account.id}:`);
      console.warn(`  DB balance: ${account.current_balance}, Binance balance: ${balance.availableBalance} (diff: ${balanceDiff.toFixed(2)})`);
      console.warn(`  DB equity: ${account.equity}, Binance equity: ${balance.totalWalletBalance} (diff: ${equityDiff.toFixed(2)})`);

      // Auto-correct: update database with Binance values
      await updateTestnetAccountBalance(db, account.id, balance.availableBalance, 0);
      await updateTestnetAccountEquityDirect(db, account.id, balance.totalWalletBalance);

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
      // No discrepancy, just update equity with latest totalWalletBalance (includes unrealized PnL)
      await updateTestnetAccountEquityDirect(db, account.id, balance.totalWalletBalance);
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
          
          // Re-place SL order if position is still open using Algo Order API
          try {
            // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
            const binanceSide = position.side === 'long' ? 'BUY' : 'SELL';
            const slSide = binanceSide === 'BUY' ? 'SELL' : 'BUY';
            const newSLOrder = await placeStopLossOrder(testnetClient, symbol, slSide, position.size_qty, position.stop_loss, position.side === 'long' ? 'LONG' : 'SHORT');
            
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
          
          // Record SL fill event with details
          await recordTestnetTradeEvent(db, position.position_id, 'sl_order_filled', {
            order_id: position.binance_sl_order_id,
            fill_price: slOrder.avgPrice || slOrder.price,
            fill_qty: slOrder.executedQty,
            fill_time: slOrder.updateTime,
          });
          
          // Check if position is still open in database
          if (position.status === 'open') {
            await closeTestnetPositionEngine(db, position, position.stop_loss, 'stop_loss_filled');
          }
        } else {
          // SL order is still open - log status for traceability
          console.log(`[TestnetEngine] SL order ${position.binance_sl_order_id} active: status=${slOrder.status}, price=${slOrder.stopPrice}`);
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
          
          // Re-place TP order if position is still open using Algo Order API
          try {
            // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
            const binanceSide = position.side === 'long' ? 'BUY' : 'SELL';
            const tpSide = binanceSide === 'BUY' ? 'SELL' : 'BUY';
            const newTPOrder = await placeTakeProfitOrder(testnetClient, symbol, tpSide, position.size_qty, position.take_profit, position.side === 'long' ? 'LONG' : 'SHORT');
            
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
          
          // Record TP fill event with details
          await recordTestnetTradeEvent(db, position.position_id, 'tp_order_filled', {
            order_id: position.binance_tp_order_id,
            fill_price: tpOrder.avgPrice || tpOrder.price,
            fill_qty: tpOrder.executedQty,
            fill_time: tpOrder.updateTime,
          });
          
          if (position.status === 'open') {
            await closeTestnetPositionEngine(db, position, position.take_profit, 'take_profit_filled');
          }
        } else {
          // TP order is still open - log status for traceability
          console.log(`[TestnetEngine] TP order ${position.binance_tp_order_id} active: status=${tpOrder.status}, price=${tpOrder.stopPrice}`);
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
 * SL/TP is now managed by Binance server-side via Algo Orders
 * This function only updates PnL, order status is synced via syncTestnetPositions
 */
export async function updateTestnetPositionsPnL(db, currentPrice) {
  if (!testnetClient) {
    return;
  }

  try {
    // Get all open positions
    const openPositions = await getTestnetPositions(db, { status: 'open' });
    
    for (const position of openPositions) {
      const isLong = position.side === 'long';
      const priceDiff = isLong 
        ? currentPrice - position.entry_price 
        : position.entry_price - currentPrice;
      
      const unrealizedPnl = priceDiff * position.size_qty;
      
      // Update position
      await updateTestnetPosition(db, position.position_id, {
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
      });
      
      // SL/TP is now managed by Binance server-side via Algo Orders
      // Order status is synced via syncTestnetPositions called in price update cycle
      // No need for internal checkTestnetSLTP anymore
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

// Re-export Binance client functions for use in scheduler
export { placeLimitOrder, cancelOrder };
