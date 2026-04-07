// Price Update Scheduler - Runs every 30 seconds
// Updates position PnL, checks SL/TP, closes positions, creates account snapshots

import cron from 'node-cron';

let db = null;
let dbEnabled = false;
let isRunning = false;

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
    console.log(`[PriceScheduler] ${new Date().toISOString()} - Updating prices and positions...`);
    
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
    console.log(`[PriceScheduler] ${new Date().toISOString()} - Creating account snapshots...`);
    
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
