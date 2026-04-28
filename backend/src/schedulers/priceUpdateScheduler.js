// Price Update Scheduler - Runs every 1 minute
// Updates position PnL, checks SL/TP, closes positions, creates account snapshots
// Uses 1-minute candle data for accurate SL/TP detection
// Supports both Paper Trading and Binance Testnet

import cron from 'node-cron';
import { formatVietnamTime } from '../utils/dateHelpers.js';

let db = null;
let dbEnabled = false;
let isRunning = false;
let testnetEnabled = false;

/**
 * Initialize the price update scheduler
 */
export async function initPriceUpdateScheduler(database, enabled) {
  db = database;
  dbEnabled = enabled;
  
  // Check if testnet is enabled
  testnetEnabled = process.env.BINANCE_ENABLED === 'true';
  
  if (!dbEnabled) {
    console.log('[PriceScheduler] Database not enabled, price updates skipped');
    return;
  }
  
  // Run immediately on startup
  runPriceUpdateJob().catch(err => {
    console.error('[PriceScheduler] Initial job failed:', err.message);
  });
  
  // Schedule: every 10 seconds (using setInterval instead of cron for sub-minute intervals)
  setInterval(() => {
    if (!isRunning) {
      runPriceUpdateJob().catch(err => {
        console.error('[PriceScheduler] Scheduled job failed:', err.message);
      });
    } else {
      console.log('[PriceScheduler] Previous job still running, skipping this cycle');
    }
  }, 10000); // 10 seconds
  
  // Schedule: account snapshot every 5 minutes (keep cron for this)
  cron.schedule('0 */5 * * *', () => {
    if (dbEnabled && db) {
      runAccountSnapshotJob().catch(err => {
        console.error('[PriceScheduler] Snapshot job failed:', err.message);
      });
    }
  });
}

/**
 * Run price update job
 */
async function runPriceUpdateJob() {
  isRunning = true;
  const startTime = Date.now();
  
  try {
    // Fetch current prices with timeout protection
    const prices = await fetchCurrentPrices();
    
    if (!prices) {
      console.log('[PriceScheduler] Failed to fetch prices, skipping this cycle');
      return;
    }
    
    // Update BTC positions
    if (prices.btc) {
      await updateSymbolPositions('BTC', prices.btc.price, prices.btc);
    }
    
    // Update ETH positions
    if (prices.eth) {
      await updateSymbolPositions('ETH', prices.eth.price, prices.eth);
    }
    
    // Update testnet positions (if enabled)
    if (testnetEnabled) {
      await updateTestnetPositions(prices);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[PriceScheduler] Completed in ${duration}ms`);

  } catch (error) {
    console.error('[PriceScheduler] Error in price update job:', error.message);
    console.error('[PriceScheduler] Stack:', error.stack);
  } finally {
    isRunning = false;
  }
}

/**
 * Fetch current prices for BTC and ETH
 * Uses Binance real-time API for paper trading (no rate limit issues)
 * Also updates latest_prices in database to keep data fresh
 */
async function fetchCurrentPrices() {
  try {
    const { fetchRealTimePrices } = await import('../price-fetcher.js');
    const { saveLatestPrice } = await import('../db/database.js');

    // Pass db parameter to enable database fallback
    const priceData = await fetchRealTimePrices(db);

    // Update latest_prices in database to ensure fresh data for analysis
    if (db && priceData) {
      try {
        const btcPrice = priceData.btc?.price || 0;
        const ethPrice = priceData.eth?.price || 0;

        await saveLatestPrice(db, 'BTC', btcPrice, 0, 0, 0, 0);
        await saveLatestPrice(db, 'ETH', ethPrice, 0, 0, 0, 0);

        console.log(`[PriceScheduler] Updated latest_prices - BTC: $${btcPrice}, ETH: $${ethPrice}`);
      } catch (saveError) {
        console.error('[PriceScheduler] Failed to update latest_prices:', saveError.message);
        console.error('[PriceScheduler] Error stack:', saveError.stack);
      }
    } else {
      console.log(`[PriceScheduler] Skipping DB update: db=${db ? 'OK' : 'NULL'}, priceData.btc=${priceData?.btc ? 'OK' : 'NULL'}, priceData.eth=${priceData?.eth ? 'OK' : 'NULL'}`);
    }

    return {
      btc: priceData.btc || null,
      eth: priceData.eth || null
    };
  } catch (error) {
    console.error('[PriceScheduler] Real-time price fetch error:', error.message);
    console.error('[PriceScheduler] Error stack:', error.stack);
    // Return null to indicate failure, but don't throw to prevent hanging
    return null;
  }
}

/**
 * Update positions for a specific symbol
 * @param {string} symbol - Symbol name (BTC, ETH)
 * @param {number} currentPrice - Current price (close of 1m candle)
 * @param {Object} candle - Full 1m candle data (open, high, low, close, volume)
 */
async function updateSymbolPositions(symbol, currentPrice, candle) {
  try {
    const { updateOpenPositions, calculateAccountEquity } = await import('../services/paperTradingEngine.js');
    const { getAllAccounts } = await import('../db/database.js');

    console.log(`[PriceScheduler] Updating ${symbol} positions at $${currentPrice.toLocaleString()} (candle: O:${candle?.open} H:${candle?.high} L:${candle?.low} C:${candle?.close})`);

    // Check and execute pending orders first with candle data
    await checkAndExecutePendingOrders(symbol, currentPrice, candle);

    // Check and execute testnet pending orders
    await checkTestnetPendingOrders(symbol, currentPrice, candle);

    // Update all open positions with candle data for SL/TP detection
    const result = await updateOpenPositions(db, symbol, currentPrice, candle);
    
    console.log(`[PriceScheduler] ${symbol}: Updated ${result.updated} positions, closed ${result.closed.length}`);
    
    if (result.errors.length > 0) {
      console.error(`[PriceScheduler] ${symbol} errors:`, result.errors);
    }
    
    // Update account equity for ALL accounts for this symbol
    const allAccounts = await getAllAccounts(db);
    const symbolAccounts = allAccounts.filter(a => a.symbol === symbol);
    
    for (const account of symbolAccounts) {
      await calculateAccountEquity(db, account);
      console.log(`[PriceScheduler] Updated equity for account ${account.id} (${account.method_id}): ${account.equity}`);
    }
    
  } catch (error) {
    console.error(`[PriceScheduler] Error updating ${symbol} positions:`, error.message);
  }
}

// Store previous prices to detect price crossing
const previousPrices = {
  BTC: null,
  ETH: null
};

/**
 * Check pending orders and execute when price hits entry level
 * Uses candle high/low for accurate trigger detection
 * @param {string} symbol - Symbol name (BTC, ETH)
 * @param {number} currentPrice - Current price (close of 1m candle)
 * @param {Object} candle - Full 1m candle data (open, high, low, close, volume)
 */
async function checkAndExecutePendingOrders(symbol, currentPrice, candle) {
  try {
    const { getPendingOrders, executePendingOrder, getAccountById } = await import('../db/database.js');
    const { openPosition } = await import('../services/paperTradingEngine.js');

    // Get all pending orders for this symbol
    const pendingOrders = await getPendingOrders(db, { symbol, status: 'pending' });

    if (pendingOrders.length === 0) return;

    console.log(`[PriceScheduler] Checking ${pendingOrders.length} pending orders for ${symbol} at $${currentPrice.toLocaleString()} (candle H:${candle?.high} L:${candle?.low})`);

    const previousPrice = previousPrices[symbol];

    for (const order of pendingOrders) {
      const isLong = order.side === 'long';
      const entryPrice = order.entry_price;

      // Check if price crossed the entry level using candle high/low
      // For long: execute if candle low is at or below entry (price dropped to entry)
      // For short: execute if candle high is at or above entry (price rose to entry)
      // Also execute if current price is at/beyond entry (fallback)
      let shouldExecute = false;

      if (isLong) {
        // Long: Execute if candle low is at or below entry
        if (candle && candle.low <= entryPrice) {
          shouldExecute = true;
        } else if (currentPrice <= entryPrice) {
          // Fallback: check current price
          shouldExecute = true;
        }
      } else {
        // Short: Execute if candle high is at or above entry
        if (candle && candle.high >= entryPrice) {
          shouldExecute = true;
        } else if (currentPrice >= entryPrice) {
          // Fallback: check current price
          shouldExecute = true;
        }
      }
      
      if (shouldExecute) {
        try {
          const account = await getAccountById(db, order.account_id);
          if (!account) {
            console.error(`[PriceScheduler] Account not found for order ${order.id} (account_id: ${order.account_id})`);
            continue;
          }

          // Check volume limit before executing pending order
          // Market orders may have filled the volume limit before this pending order executes
          const { getPositions, cancelPendingOrder } = await import('../db/database.js');
          const openPositions = await getPositions(db, { account_id: account.id, status: 'open' });
          const totalOpenVolume = openPositions.reduce((sum, pos) => sum + (pos.size_usd || 0), 0);
          const pendingOrderVolume = order.size_usd;
          const totalVolume = totalOpenVolume + pendingOrderVolume;
          const maxVolume = order.maxVolumePerAccount || 2000;

          // If market volume already at limit, cancel pending order
          if (totalOpenVolume >= maxVolume) {
            console.log(`[PriceScheduler] Cancelling pending order ${order.id}: market volume $${totalOpenVolume.toFixed(2)} already at limit $${maxVolume}`);
            await cancelPendingOrder(db, order.id, 'volume_limit_reached');
            continue;
          }

          // If market + pending would exceed limit, cancel pending order
          if (totalVolume > maxVolume) {
            console.log(`[PriceScheduler] Cancelling pending order ${order.id}: market ($${totalOpenVolume.toFixed(2)}) + pending ($${pendingOrderVolume?.toFixed(2) || 'N/A'}) would exceed limit $${maxVolume}`);
            await cancelPendingOrder(db, order.id, 'volume_limit_reached');
            continue;
          }

          console.log(`[PriceScheduler] Volume check passed for pending order ${order.id}: $${totalVolume?.toFixed(2) || 'N/A'} <= $${maxVolume}`);
          
          // Execute the order (convert to actual position)
          // Use entry_price as the execution price since that's where the limit was hit
          const positionData = {
            side: order.side,
            entry_price: entryPrice,
            current_price: currentPrice, // Set to current market price at execution
            stop_loss: order.stop_loss,
            take_profit: order.take_profit,
            size_usd: order.size_usd,
            size_qty: order.size_qty,
            risk_usd: order.risk_usd,
            risk_percent: order.risk_percent,
            expected_rr: order.expected_rr,
            invalidation_level: order.invalidation_level,
            method_id: order.method_id || 'ict',
            maxVolumePerAccount: maxVolume,
            // ICT strategy tracking (required for schema)
            ict_strategy: null,
            tp_levels: null,
            tp_hit_count: 0,
            partial_closed: 0,
            r_multiple: order.expected_rr || 0
          };
          
          await openPosition(db, account, positionData, order.linked_prediction_id);
          await executePendingOrder(db, order.id);
          
          console.log(`[PriceScheduler] ${symbol} limit order executed: ${order.side} @ $${entryPrice.toLocaleString()} (prev: $${previousPrice?.toLocaleString()}, current: $${currentPrice.toLocaleString()})`);
        } catch (execError) {
          console.error(`[PriceScheduler] Failed to execute pending order ${order.id}:`, execError.message);
        }
      }
    }
    
    // Update previous price for next cycle
    previousPrices[symbol] = currentPrice;
  } catch (error) {
    console.error(`[PriceScheduler] Error checking pending orders for ${symbol}:`, error.message);
  }
}

/**
 * Check and execute testnet pending orders
 */
async function checkTestnetPendingOrders(symbol, currentPrice, candle) {
  try {
    if (process.env.BINANCE_ENABLED !== 'true') return;

    const { getTestnetPendingOrders, getTestnetAccount, executeTestnetPendingOrder } = await import('../db/testnetDatabase.js');
    const { openTestnetPosition } = await import('../services/testnetEngine.js');

    // Get all testnet pending orders for this symbol
    const pendingOrders = await getTestnetPendingOrders(db, { symbol, status: 'pending' });

    if (pendingOrders.length === 0) return;

    console.log(`[PriceScheduler] Checking ${pendingOrders.length} testnet pending orders for ${symbol} at $${currentPrice.toLocaleString()} (candle H:${candle?.high} L:${candle?.low})`);

    for (const order of pendingOrders) {
      const isLong = order.side === 'long';
      const entryPrice = order.entry_price;

      // Check if price crossed the entry level using candle high/low
      let shouldExecute = false;

      if (isLong) {
        // Long: Execute if candle low is at or below entry
        if (candle && candle.low <= entryPrice) {
          shouldExecute = true;
        } else if (currentPrice <= entryPrice) {
          // Fallback: check current price
          shouldExecute = true;
        }
      } else {
        // Short: Execute if candle high is at or above entry
        if (candle && candle.high >= entryPrice) {
          shouldExecute = true;
        } else if (currentPrice >= entryPrice) {
          // Fallback: check current price
          shouldExecute = true;
        }
      }

      if (shouldExecute) {
        try {
          const account = await getTestnetAccount(db, order.symbol, order.method_id);
          if (!account) {
            console.error(`[PriceScheduler] Testnet account not found for order ${order.order_id} (symbol: ${order.symbol}, method_id: ${order.method_id})`);
            continue;
          }

          // Check volume limit before executing testnet pending order
          // Market orders may have filled the volume limit before this pending order executes
          const { getTestnetPositions, cancelTestnetPendingOrder } = await import('../db/testnetDatabase.js');
          const { getMethodConfig } = await import('../config/methods.js');
          const openPositions = await getTestnetPositions(db, { symbol: order.symbol, method_id: order.method_id, status: 'open' });
          const totalOpenVolume = openPositions.reduce((sum, pos) => sum + (pos.size_usd || 0), 0);
          const pendingOrderVolume = order.size_usd;
          const totalVolume = totalOpenVolume + pendingOrderVolume;
          const maxVolume = order.maxVolumePerAccount || 2000;

          // Check max positions per symbol limit
          const methodConfig = getMethodConfig(order.method_id || 'kim_nghia');
          const maxPositionsPerSymbol = methodConfig?.autoEntry?.maxPositionsPerSymbol || 6;

          if (openPositions.length >= maxPositionsPerSymbol) {
            console.log(`[PriceScheduler] Cancelling testnet pending order ${order.order_id}: already have ${openPositions.length} open positions (max: ${maxPositionsPerSymbol})`);
            await cancelTestnetPendingOrder(db, order.order_id, 'max_positions_reached', order.binance_order_id);
            continue;
          }

          // If market volume already at limit, cancel pending order
          if (totalOpenVolume >= maxVolume) {
            console.log(`[PriceScheduler] Cancelling testnet pending order ${order.order_id}: market volume $${totalOpenVolume.toFixed(2)} already at limit $${maxVolume}`);
            await cancelTestnetPendingOrder(db, order.order_id, 'volume_limit_reached', order.binance_order_id);
            continue;
          }

          // If market + pending would exceed limit, cancel pending order
          if (totalVolume > maxVolume) {
            console.log(`[PriceScheduler] Cancelling testnet pending order ${order.order_id}: market ($${totalOpenVolume.toFixed(2)}) + pending ($${pendingOrderVolume?.toFixed(2) || 'N/A'}) would exceed limit $${maxVolume}`);
            await cancelTestnetPendingOrder(db, order.order_id, 'volume_limit_reached', order.binance_order_id);
            continue;
          }

          console.log(`[PriceScheduler] Volume check passed for testnet pending order ${order.order_id}: $${totalVolume?.toFixed(2) || 'N/A'} <= $${maxVolume}`);

          // Cancel Binance limit order before executing as market order
          if (order.binance_order_id) {
            try {
              const { cancelOrder, getTestnetClient } = await import('../services/testnetEngine.js');
              const { getSymbol } = await import('../config/binance.js');
              const testnetClient = getTestnetClient();
              
              if (testnetClient) {
                await cancelOrder(testnetClient, getSymbol(), order.binance_order_id);
                console.log(`[PriceScheduler] Cancelled Binance limit order ${order.binance_order_id} before executing as market order`);
              }
            } catch (cancelError) {
              console.error(`[PriceScheduler] Failed to cancel Binance limit order ${order.binance_order_id}:`, cancelError.message);
              // Continue to execute even if cancel fails
            }
          }

          // Execute the order (convert to actual position on Binance testnet)
          const positionData = {
            side: order.side,
            entry_price: entryPrice,
            stop_loss: order.stop_loss,
            take_profit: order.take_profit,
            size_usd: order.size_usd,
            size_qty: order.size_qty,
            risk_usd: order.risk_usd,
            risk_percent: order.risk_percent,
            expected_rr: order.expected_rr,
            invalidation_level: order.invalidation_level,
            maxVolumePerAccount: maxVolume
          };

          await openTestnetPosition(db, account, positionData, order.linked_prediction_id, order.method_id);
          await executeTestnetPendingOrder(db, order.order_id);

          console.log(`[PriceScheduler] Testnet limit order executed: ${order.side} @ $${entryPrice.toLocaleString()}`);
        } catch (execError) {
          console.error(`[PriceScheduler] Failed to execute testnet pending order ${order.order_id}:`, execError.message);
        }
      }
    }
  } catch (error) {
    console.error(`[PriceScheduler] Error checking testnet pending orders for ${symbol}:`, error.message);
  }
}

/**
 * Update equity for all accounts
 */
async function updateAllAccountsEquity() {
  try {
    const { getAllAccounts, calculateAccountEquity } = await import('../db/database.js');
    const accounts = await getAllAccounts(db);
    
    for (const account of accounts) {
      await calculateAccountEquity(db, account);
    }
    
  } catch (error) {
    console.error('[PriceScheduler] Error updating account equity:', error.message);
  }
}

/**
 * Run account snapshot job (every 5 minutes)
 */
async function runAccountSnapshotJob() {
  try {
    console.log(`[PriceScheduler] ${formatVietnamTime(new Date())} - Creating account snapshots...`);
    
    const { getAllAccounts, createAccountSnapshot: createSnap } = await import('../db/database.js');
    const accounts = await getAllAccounts(db);
    
    for (const account of accounts) {
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
    
    console.log(`[PriceScheduler] Created snapshots for ${accounts.length} paper trading accounts`);
    
    // Create testnet account snapshots (if enabled)
    if (testnetEnabled) {
      await createTestnetAccountSnapshots();
    }
    
  } catch (error) {
    console.error('[PriceScheduler] Snapshot error:', error.message);
  }
}

/**
 * Update testnet positions with current price
 * @param {Object} prices - Current prices from Binance API
 */
async function updateTestnetPositions(prices) {
  try {
    const { updateTestnetPositionsPnL, syncTestnetAccount } = await import('../services/testnetEngine.js');
    const { getTestnetPositions, getTestnetAccount } = await import('../db/testnetDatabase.js');

    // Get current price for BTC (testnet only supports BTC)
    const currentPrice = prices.btc?.price;
    if (!currentPrice) {
      console.log('[PriceScheduler] No BTC price available for testnet update');
      return;
    }

    console.log(`[PriceScheduler] Updating testnet positions at $${currentPrice.toLocaleString()}`);

    // Update unrealized PnL and check SL/TP
    await updateTestnetPositionsPnL(db, currentPrice);

    // Sync account balance from Binance (every cycle)
    const testnetAccount = await getTestnetAccount(db, 'BTC', 'kim_nghia');
    if (testnetAccount) {
      try {
        await syncTestnetAccount(db, testnetAccount);
      } catch (syncError) {
        console.error('[PriceScheduler] Testnet account sync failed:', syncError.message);
      }
    }

    console.log('[PriceScheduler] Testnet positions updated');
  } catch (error) {
    console.error('[PriceScheduler] Error updating testnet positions:', error.message);
  }
}

/**
 * Create testnet account snapshots
 */
async function createTestnetAccountSnapshots() {
  try {
    const { getTestnetAccount, createTestnetAccountSnapshot } = await import('../db/testnetDatabase.js');

    const testnetAccount = await getTestnetAccount(db, 'BTC', 'kim_nghia');
    if (testnetAccount) {
      await createTestnetAccountSnapshot(db, testnetAccount.id);
      console.log(`[PriceScheduler] Created testnet account snapshot for account ${testnetAccount.id}`);
    }
  } catch (error) {
    console.error('[PriceScheduler] Error creating testnet account snapshots:', error.message);
  }
}
