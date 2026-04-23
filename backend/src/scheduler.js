import cron from 'node-cron';
import { fetchPrices } from './price-fetcher.js';
import { cache } from './cache.js';
import { METHODS } from './config/methods.js';
import { createAnalyzer } from './analyzers/analyzerFactory.js';
import { formatVietnamTime } from './utils/dateHelpers.js';

let db = null;
let dbEnabled = false;

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
  
  // ICT Method - TEMPORARILY DISABLED - ICT method paused, code preserved for future multi-method support
  // ICT Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
  // cron.schedule('*/15 * * * *', () => {
  //   console.log('[Scheduler] Triggering ICT analysis...');
  //   runMethodAnalysis('ict').catch(err => {
  //     console.error('[Scheduler] ICT analysis failed:', err.message);
  //   });
  // });

  // KimNghia Method - Runs at 0m, 10m, 20m, 30m, 40m, 50m (every 10 minutes)
  cron.schedule('0,10,20,30,40,50 * * * *', () => {
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
  
  console.log('[Scheduler] Staggered scheduler registered (ICT: disabled, KimNghia: 0,10,20,30,40,50 * * * *)');
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
        
        // Save analysis for BTC with method_id and raw data
        const btcResult = await saveAnalysis(db, 'BTC', priceData, analysis, methodId, analysis.raw_question, analysis.raw_answer);
        const btcPredictionId = btcResult.predictionIds?.['4h'] || btcResult.predictionIds?.['1d'];

        // Process position decisions from AI analysis
        if (analysis.btc?.position_decisions && Array.isArray(analysis.btc.position_decisions)) {
          const { closePosition, closePartialPosition, updateStopLoss, reversePosition } = await import('./services/paperTradingEngine.js');
          const { fetchRealTimePrices } = await import('./price-fetcher.js');
          const { getPosition } = await import('./db/database.js');
          const { getMethodConfig } = await import('./config/methods.js');
          
          // Get method confidence threshold
          const methodConfig = getMethodConfig(methodId);
          const confidenceThreshold = (methodConfig.autoEntry?.minConfidence || 70) / 100;

          for (const decision of analysis.btc.position_decisions) {
            // Check confidence threshold
            if (decision.confidence < confidenceThreshold) {
              console.log(`[Scheduler][${method.name}] Skipping position decision for ${decision.position_id}: confidence ${decision.confidence} < threshold ${confidenceThreshold}`);
              continue;
            }
            
            // Handle hold action (do nothing)
            if (decision.action === 'hold') {
              console.log(`[Scheduler][${method.name}] Holding position ${decision.position_id}: ${decision.reason}`);
              continue;
            }
            
            try {
              const position = await getPosition(db, decision.position_id);
              if (!position || position.status !== 'open') {
                console.log(`[Scheduler][${method.name}] Position ${decision.position_id} not found or not open, skipping`);
                continue;
              }
              
              const priceData = await fetchRealTimePrices();
              const currentPrice = priceData['btc']?.price || position.current_price;
              
              // Handle close_early (full close)
              if (decision.action === 'close_early') {
                await closePosition(db, position, currentPrice, `ai_recommendation: ${decision.reason}`);
                console.log(`[Scheduler][${method.name}] Closed position ${decision.position_id} early: ${decision.reason}`);
              }
              
              // Handle close_partial
              else if (decision.action === 'close_partial') {
                const closePercent = decision.close_percent || 0.5;
                await closePartialPosition(db, position, closePercent, currentPrice, `ai_recommendation: ${decision.reason}`);
                console.log(`[Scheduler][${method.name}] Closed ${(closePercent * 100).toFixed(0)}% of position ${decision.position_id}: ${decision.reason}`);
              }
              
              // Handle move_sl
              else if (decision.action === 'move_sl') {
                const newSl = decision.new_sl;
                if (newSl) {
                  await updateStopLoss(db, position, newSl, `ai_recommendation: ${decision.reason}`);
                  console.log(`[Scheduler][${method.name}] Moved SL for position ${decision.position_id} to ${newSl}: ${decision.reason}`);
                }
              }
              
              // Handle reverse
              else if (decision.action === 'reverse') {
                const suggestion = {
                  side: position.side === 'long' ? 'short' : 'long',
                  entry_price: currentPrice,
                  stop_loss: decision.new_sl || position.stop_loss,
                  take_profit: decision.new_tp || position.take_profit,
                  size_usd: position.size_usd,
                  size_qty: position.size_qty,
                  risk_usd: position.risk_usd,
                  risk_percent: position.risk_percent,
                  expected_rr: position.expected_rr
                };
                await reversePosition(db, position, currentPrice, suggestion, `ai_recommendation: ${decision.reason}`);
                console.log(`[Scheduler][${method.name}] Reversed position ${decision.position_id}: ${decision.reason}`);
              }
            } catch (error) {
              console.error(`[Scheduler][${method.name}] Failed to execute position decision for ${decision.position_id}:`, error.message);
            }
          }
        }
        
        // Process pending order decisions from AI analysis
        if (analysis.btc?.pending_order_decisions && Array.isArray(analysis.btc.pending_order_decisions)) {
          const { cancelPendingOrder, modifyPendingOrder, getPendingOrders } = await import('./db/database.js');
          const { getMethodConfig } = await import('./config/methods.js');
          
          // Get method confidence threshold
          const methodConfig = getMethodConfig(methodId);
          const confidenceThreshold = (methodConfig.autoEntry?.minConfidence || 70) / 100;

          for (const decision of analysis.btc.pending_order_decisions) {
            // Check confidence threshold
            if (decision.confidence < confidenceThreshold) {
              console.log(`[Scheduler][${method.name}] Skipping pending order decision for ${decision.order_id}: confidence ${decision.confidence} < threshold ${confidenceThreshold}`);
              continue;
            }
            
            // Handle hold action (do nothing)
            if (decision.action === 'hold') {
              console.log(`[Scheduler][${method.name}] Holding pending order ${decision.order_id}: ${decision.reason}`);
              continue;
            }
            
            try {
              const pendingOrders = await getPendingOrders(db, { order_id: decision.order_id });
              const order = pendingOrders[0];
              if (!order || order.status !== 'pending') {
                console.log(`[Scheduler][${method.name}] Pending order ${decision.order_id} not found or not pending, skipping`);
                continue;
              }
              
              // Handle cancel
              if (decision.action === 'cancel') {
                await cancelPendingOrder(db, order.id, `ai_recommendation: ${decision.reason}`);
                console.log(`[Scheduler][${method.name}] Cancelled pending order ${decision.order_id}: ${decision.reason}`);
              }
              
              // Handle modify
              else if (decision.action === 'modify') {
                await modifyPendingOrder(db, order, decision.new_entry, decision.new_sl, decision.new_tp);
                console.log(`[Scheduler][${method.name}] Modified pending order ${decision.order_id}: ${decision.reason}`);
              }
            } catch (error) {
              console.error(`[Scheduler][${method.name}] Failed to execute pending order decision for ${decision.order_id}:`, error.message);
            }
          }
        }
        
        // Cache with method_id
        cache.setMethod(methodId, {
          prices: priceData,
          analysis: analysis,
          lastUpdated: priceData.timestamp
        });
        
        // Get open positions for this method's account
        const openPositions = await getPositions(db, { account_id: account.id, status: 'open' });
        
        // Auto-entry evaluation (method-specific)
        const decision = await evaluateAutoEntry(analysis.btc, account, openPositions, method, db);
        
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
              
              // Cap pending order size at maxPendingOrderSize
              let orderSizeUsd = position.size_usd;
              let orderSizeQty = position.size_qty;
              const maxPendingOrderSize = method.autoEntry.maxPendingOrderSize || 2000;
              
              if (orderSizeUsd > maxPendingOrderSize) {
                console.log(`[Scheduler][${method.name}] Pending order size $${orderSizeUsd.toFixed(2)} exceeds max $${maxPendingOrderSize}, capping to $${maxPendingOrderSize}`);
                orderSizeUsd = maxPendingOrderSize;
                // Recalculate sizeQty based on capped sizeUsd
                orderSizeQty = orderSizeUsd / position.entry_price;
              }
              
              await createPendingOrder(db, {
                order_id: randomUUID(),
                account_id: account.id,
                symbol: 'BTC',
                side: position.side,
                entry_price: position.entry_price,
                stop_loss: position.stop_loss,
                take_profit: position.take_profit,
                size_usd: orderSizeUsd,
                size_qty: orderSizeQty,
                risk_usd: position.risk_usd,
                risk_percent: position.risk_percent,
                expected_rr: position.expected_rr,
                linked_prediction_id: btcPredictionId,
                invalidation_level: position.invalidation_level,
                method_id: methodId
              });
              console.log(`[Scheduler][${method.name}] BTC limit order created (pending): entry ${position.entry_price}, size $${orderSizeUsd.toFixed(2)}`);
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
