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
  setLeverage,
  setMarginType,
} from './binanceClient.js';
import { binanceConfig, getLeverage, getSymbol } from '../config/binance.js';
import {
  createTestnetPosition,
  getTestnetPosition,
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

  // Set leverage for the symbol
  try {
    await setLeverage(testnetClient, getSymbol(), getLeverage());
    await setMarginType(testnetClient, getSymbol(), 'ISOLATED');
    console.log('[TestnetEngine] Leverage and margin type configured');
  } catch (error) {
    console.error('[TestnetEngine] Failed to configure leverage/margin:', error.message);
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
 */
export async function checkTestnetSLTP(db, position, currentPrice) {
  if (position.status !== 'open') {
    return null;
  }

  const isLong = position.side === 'BUY';
  
  // Check SL hit
  const slHit = isLong ? currentPrice <= position.stop_loss : currentPrice >= position.stop_loss;
  
  // Check TP hit
  const tpHit = isLong ? currentPrice >= position.take_profit : currentPrice <= position.take_profit;
  
  if (slHit) {
    console.log(`[TestnetEngine] SL hit for position ${position.position_id} at ${currentPrice}`);
    await closeTestnetPositionEngine(db, position, currentPrice, 'stop_loss');
    return 'stop_loss';
  }
  
  if (tpHit) {
    console.log(`[TestnetEngine] TP hit for position ${position.position_id} at ${currentPrice}`);
    await closeTestnetPositionEngine(db, position, currentPrice, 'take_profit');
    return 'take_profit';
  }
  
  return null;
}

/**
 * Sync testnet account with Binance
 */
export async function syncTestnetAccount(db, account) {
  if (!testnetClient) {
    console.error('[TestnetEngine] Testnet client not initialized');
    return null;
  }

  try {
    // Fetch real balance from Binance
    const balance = await getAccountBalance(testnetClient);
    
    // Update database
    await updateTestnetAccountBalance(db, account.id, balance.availableBalance, 0);
    await updateTestnetAccountEquity(db, account.id, balance.totalUnrealizedProfit);
    
    // Create snapshot
    await createTestnetAccountSnapshot(db, account.id);
    
    console.log(`[TestnetEngine] Synced testnet account ${account.id}: balance=${balance.availableBalance}, equity=${balance.totalWalletBalance}`);
    
    return balance;
  } catch (error) {
    console.error('[TestnetEngine] Failed to sync testnet account:', error.message);
    throw error;
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
