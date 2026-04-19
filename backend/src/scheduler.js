import cron from 'node-cron';
import { fetchPrices } from './price-fetcher.js';
import { analyzeWithGroq } from './groqAnalyzer.js';
import { cache } from './cache.js';
import { METHODS } from './config/methods.js';
import { createAnalyzer } from './analyzers/analyzerFactory.js';

let db = null;
let dbEnabled = false;

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

// Initialize database on startup (optional)
async function initDb() {
  try {
    // Check if sqlite3 is available
    let sqlite3;
    try {
      sqlite3 = await import('sqlite3');
      console.log('[Scheduler] sqlite3 module is available');
    } catch (importError) {
      console.error('[Scheduler] sqlite3 module not found:', importError.message);
      console.log('[Scheduler] Running without database persistence');
      db = null;
      dbEnabled = false;
      return;
    }

    // Dynamically import to avoid startup failure if sqlite3 not installed
    const { initDatabase } = await import('./db/database.js');
    const { runMigrations } = await import('./db/migrations.js');
    db = await initDatabase();
    await runMigrations(db);
    dbEnabled = true;
    console.log('[Scheduler] Database initialized and migrations run');
  } catch (error) {
    console.error('[Scheduler] Database initialization failed:', error.message);
    console.error('[Scheduler] Error stack:', error.stack);
    console.log('[Scheduler] Running without database persistence');
    db = null;
    dbEnabled = false;
  }
}

// Run analysis job every 15 minutes
export async function startScheduler() {
  console.log('[Scheduler] Starting multi-method staggered scheduler...');
  
  // Initialize database
  await initDb();
  
  // ICT Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
  cron.schedule('*/15 * * * *', () => {
    console.log('[Scheduler] Triggering ICT analysis...');
    runMethodAnalysis('ict').catch(err => {
      console.error('[Scheduler] ICT analysis failed:', err.message);
    });
  });
  
  // KimNghia Method - Runs at 7m30s, 22m30s, 37m30s, 52m30s (7.5 min offset)
  cron.schedule('7,22,37,52 * * * *', () => {
    console.log('[Scheduler] Triggering KimNghia analysis...');
    runMethodAnalysis('kim_nghia').catch(err => {
      console.error('[Scheduler] KimNghia analysis failed:', err.message);
    });
  });
  
  // Validate expired predictions every hour (only if db enabled)
  cron.schedule('0 * * * *', async () => {
    if (dbEnabled && db) {
      try {
        console.log('[Scheduler] Validating expired predictions...');
        const { validatePredictions } = await import('./db/database.js');
        await validatePredictions(db);
      } catch (err) {
        console.error('[Scheduler] Validation error:', err.message);
      }
    }
  });
  
  // Run data retention daily at 3 AM (only if db enabled)
  cron.schedule('0 3 * * *', async () => {
    if (dbEnabled && db) {
      try {
        console.log('[Scheduler] Running daily data retention...');
        const { runDataRetention } = await import('./db/database.js');
        await runDataRetention(db);
      } catch (err) {
        console.error('[Scheduler] Data retention error:', err.message);
      }
    }
  });
  
  // Start price update scheduler (30-second intervals)
  if (dbEnabled && db) {
    (async () => {
      try {
        const { initPriceUpdateScheduler } = await import('./schedulers/priceUpdateScheduler.js');
        initPriceUpdateScheduler(db, true);
      } catch (err) {
        console.log('[Scheduler] Could not start price update scheduler:', err.message);
      }
    })();
  }
  
  console.log('[Scheduler] Staggered scheduler registered (ICT: */15 * * * *, KimNghia: 7,22,37,52 * * * *)');
}

/**
 * Run analysis for a specific method
 * @param {string} methodId - Method ID ('ict' or 'kim_nghia')
 */
async function runMethodAnalysis(methodId) {
  const startTime = Date.now();
  const method = METHODS[methodId];
  
  console.log(`\n[Scheduler][${method.name}] Starting analysis at ${formatVietnamTime(new Date())}...`);
  
  try {
    // Import database functions
    const { getOrCreateAccount } = await import('./db/database.js');
    
    // Step 1: Fetch price data
    const priceData = await fetchPrices(db);
    
    // Step 2: Get or create method-specific account for BTC
    const account = await getOrCreateAccount(db, 'BTC', methodId, 100);
    
    // Step 3: Run method-specific analysis using analyzer factory
    const analyzer = createAnalyzer(method);
    const analysis = await analyzer.analyze(priceData, db);
    
    // Step 4: Save to database with method_id
    if (dbEnabled && db) {
      try {
        const { saveAnalysis, getPositions } = await import('./db/database.js');
        const { evaluateAutoEntry } = await import('./services/autoEntryLogic.js');
        const { openPosition } = await import('./services/paperTradingEngine.js');
        
        // Save analysis for BTC with method_id
        const btcResult = await saveAnalysis(db, 'BTC', priceData, analysis, methodId);
        const btcPredictionId = btcResult.predictionIds?.['4h'] || btcResult.predictionIds?.['1d'];
        
        // Cache with method_id
        cache.setMethod(methodId, {
          prices: priceData,
          analysis: analysis,
          lastUpdated: priceData.timestamp
        });
        
        // Get open positions for this method's account
        const openPositions = await getPositions(db, { account_id: account.id, status: 'open' });
        
        // Auto-entry evaluation (method-specific)
        const decision = await evaluateAutoEntry(analysis.btc, account, openPositions, method.autoEntry, db);
        
        console.log(`[Scheduler][${method.name}] Auto-entry decision: ${decision.action} - ${decision.reason}`);
        
        if (decision.shouldEnter && decision.suggestedPosition) {
          try {
            const position = decision.suggestedPosition;
            console.log(`[Scheduler][${method.name}] BTC order: type=${decision.orderType}, side=${position.side}, entry=${position.entry_price}, current_price=${analysis.btc.current_price}, SL=${position.stop_loss}, TP=${position.take_profit}`);

            if (decision.orderType === 'market') {
              // Execute immediately as market order
              await openPosition(db, account, position, btcPredictionId, methodId);
              console.log(`[Scheduler][${method.name}] BTC market order executed immediately at ${position.entry_price}`);
            } else {
              // Create pending limit order
              const { createPendingOrder } = await import('./db/database.js');
              const { randomUUID } = await import('crypto');
              await createPendingOrder(db, {
                order_id: randomUUID(),
                account_id: account.id,
                symbol: 'BTC',
                side: position.side,
                entry_price: position.entry_price,
                stop_loss: position.stop_loss,
                take_profit: position.take_profit,
                size_usd: position.size_usd,
                size_qty: position.size_qty,
                risk_usd: position.risk_usd,
                risk_percent: position.risk_percent,
                expected_rr: position.expected_rr,
                linked_prediction_id: btcPredictionId,
                invalidation_level: position.invalidation_level,
                method_id: methodId
              });
              console.log(`[Scheduler][${method.name}] BTC limit order created (pending): entry ${position.entry_price}`);
            }
          } catch (posError) {
            console.error(`[Scheduler][${method.name}] Failed to process BTC order:`, posError.message);
          }
        }
        
        console.log(`[Scheduler][${method.name}] Analysis complete - Account: ${account.id}, Balance: $${account.current_balance.toFixed(2)}`);
      } catch (dbError) {
        console.error(`[Scheduler][${method.name}] Database save error:`, dbError.message);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Scheduler][${method.name}] Completed in ${duration}ms\n`);
    
  } catch (error) {
    console.error(`[Scheduler][${method.name}] Failed:`, error.message);
    console.log(`[Scheduler][${method.name}] Will retry in next scheduled run\n`);
  }
}
