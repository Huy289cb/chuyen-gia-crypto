// Price Update Scheduler - Runs every 30 seconds
// Updates position PnL, checks SL/TP, closes positions, creates account snapshots

import cron from 'node-cron';

let db = null;
let dbEnabled = false;
let isRunning = false;

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
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Initialize the price update scheduler
 */
export async function initPriceUpdateScheduler(database, enabled) {
  db = database;
  dbEnabled = enabled;
  
  if (!dbEnabled) {
    console.log('[PriceScheduler] Database not enabled, price updates skipped');
    return;
  }
  
  console.log('[PriceScheduler] Initializing 30-second price update scheduler...');
  
  // Run immediately on startup
  runPriceUpdateJob();
  
  // Schedule: every 30 seconds
  cron.schedule('*/30 * * * * *', () => {
    if (!isRunning) {
      runPriceUpdateJob();
    } else {
      console.log('[PriceScheduler] Previous job still running, skipping this cycle');
    }
  });
  
  // Schedule: account snapshot every 5 minutes
  cron.schedule('0 */5 * * * *', () => {
    if (dbEnabled && db) {
      runAccountSnapshotJob();
    }
  });
  
  console.log('[PriceScheduler] 30-second scheduler registered');
}

/**
 * Run price update job
 */
async function runPriceUpdateJob() {
  isRunning = true;
  const startTime = Date.now();
  
  try {
    console.log(`[PriceScheduler] ${formatVietnamTime(new Date())} - Updating prices and positions...`);
    
    // Fetch current prices
    const prices = await fetchCurrentPrices();
    
    if (!prices) {
      console.log('[PriceScheduler] Failed to fetch prices, using cached data');
      isRunning = false;
      return;
    }
    
    // Update BTC positions
    if (prices.btc) {
      await updateSymbolPositions('BTC', prices.btc);
    }
    
    // Update ETH positions
    if (prices.eth) {
      await updateSymbolPositions('ETH', prices.eth);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[PriceScheduler] Completed in ${duration}ms`);
    
  } catch (error) {
    console.error('[PriceScheduler] Error:', error.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Fetch current prices for BTC and ETH
 * Uses Binance real-time API for paper trading (no rate limit issues)
 */
async function fetchCurrentPrices() {
  try {
    const { fetchRealTimePrices } = await import('../price-fetcher.js');
    const priceData = await fetchRealTimePrices();
    
    return {
      btc: priceData.btc?.price || null,
      eth: priceData.eth?.price || null
    };
  } catch (error) {
    console.error('[PriceScheduler] Real-time price fetch error:', error.message);
    throw error;
  }
}

/**
 * Update positions for a specific symbol
 */
async function updateSymbolPositions(symbol, currentPrice) {
  try {
    const { updateOpenPositions, calculateAccountEquity } = await import('../services/paperTradingEngine.js');
    const { getAccountBySymbol } = await import('../db/database.js');
    
    console.log(`[PriceScheduler] Updating ${symbol} positions at $${currentPrice.toLocaleString()}`);
    
    // Check and execute pending orders first
    await checkAndExecutePendingOrders(symbol, currentPrice);
    
    // Update all open positions
    const result = await updateOpenPositions(db, symbol, currentPrice);
    
    console.log(`[PriceScheduler] ${symbol}: Updated ${result.updated} positions, closed ${result.closed.length}`);
    
    if (result.errors.length > 0) {
      console.error(`[PriceScheduler] ${symbol} errors:`, result.errors);
    }
    
    // Update account equity
    const account = await getAccountBySymbol(db, symbol);
    if (account) {
      await calculateAccountEquity(db, account);
    }
    
  } catch (error) {
    console.error(`[PriceScheduler] Error updating ${symbol} positions:`, error.message);
  }
}

/**
 * Check pending orders and execute when price hits entry level
 */
async function checkAndExecutePendingOrders(symbol, currentPrice) {
  try {
    const { getPendingOrders, executePendingOrder, getAccountBySymbol } = await import('../db/database.js');
    const { openPosition } = await import('../services/paperTradingEngine.js');
    
    // Get all pending orders for this symbol
    const pendingOrders = await getPendingOrders(db, { symbol, status: 'pending' });
    
    if (pendingOrders.length === 0) return;
    
    console.log(`[PriceScheduler] Checking ${pendingOrders.length} pending orders for ${symbol} at $${currentPrice.toLocaleString()}`);
    
    for (const order of pendingOrders) {
      const isLong = order.side === 'long';
      const entryPrice = order.entry_price;
      
      // Check if price hit entry level
      // For long: execute when price <= entry (price dropped to entry)
      // For short: execute when price >= entry (price rose to entry)
      const shouldExecute = isLong 
        ? currentPrice <= entryPrice  // Price dropped to entry level
        : currentPrice >= entryPrice; // Price rose to entry level
      
      if (shouldExecute) {
        try {
          const account = await getAccountBySymbol(db, symbol);
          if (!account) {
            console.error(`[PriceScheduler] Account not found for ${symbol}`);
            continue;
          }
          
          // Execute the order (convert to actual position)
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
            invalidation_level: order.invalidation_level
          };
          
          await openPosition(db, account, positionData, order.linked_prediction_id);
          await executePendingOrder(db, order.id);
          
          console.log(`[PriceScheduler] ${symbol} limit order executed: ${order.side} @ $${entryPrice.toLocaleString()} (current: $${currentPrice.toLocaleString()})`);
        } catch (execError) {
          console.error(`[PriceScheduler] Failed to execute pending order ${order.id}:`, execError.message);
        }
      }
    }
  } catch (error) {
    console.error(`[PriceScheduler] Error checking pending orders for ${symbol}:`, error.message);
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
    
    console.log(`[PriceScheduler] Created snapshots for ${accounts.length} accounts`);
    
  } catch (error) {
    console.error('[PriceScheduler] Snapshot error:', error.message);
  }
}
