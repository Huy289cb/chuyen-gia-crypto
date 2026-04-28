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
    
    // Initialize testnet engine if enabled
    try {
      const { initTestnetEngine } = await import('./services/testnetEngine.js');
      await initTestnetEngine();
    } catch (testnetError) {
      console.log('[Scheduler] Testnet engine initialization skipped or failed:', testnetError.message);
    }
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

  // KimNghia Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
  cron.schedule('0,15,30,45 * * * *', () => {
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
  
  console.log('[Scheduler] Staggered scheduler registered (ICT: disabled, KimNghia: 0,15,30,45 * * * *)');
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
            console.log(`[Scheduler][${method.name}] Processing position decision: position_id=${decision.position_id}, action=${decision.action}, confidence=${decision.confidence}`);

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
              console.log(`[Scheduler][${method.name}] Fetching position from database: ${decision.position_id}`);
              const position = await getPosition(db, decision.position_id);
              console.log(`[Scheduler][${method.name}] Position found:`, position ? `id=${position.id}, status=${position.status}, side=${position.side}` : 'null');
              
              if (!position || position.status !== 'open') {
                console.log(`[Scheduler][${method.name}] Position ${decision.position_id} not found or not open, skipping`);
                continue;
              }
              
              const realtimePrices = await fetchRealTimePrices();
              const currentPrice = realtimePrices['btc']?.price || position.current_price;
              
              // Handle close_early (full close)
              if (decision.action === 'close_early') {
                await closePosition(db, position, currentPrice, 'close_early');
                console.log(`[Scheduler][${method.name}] Closed position ${decision.position_id} early: ${decision.reason}`);
              }

              // Handle close_partial
              else if (decision.action === 'close_partial') {
                const closePercent = decision.close_percent || 0.5;
                await closePartialPosition(db, position, closePercent, currentPrice, 'close_partial');
                console.log(`[Scheduler][${method.name}] Closed ${(closePercent * 100).toFixed(0)}% of position ${decision.position_id}: ${decision.reason}`);
              }

              // Handle move_sl
              else if (decision.action === 'move_sl') {
                const newSl = decision.new_sl;
                if (newSl) {
                  await updateStopLoss(db, position, newSl, 'move_sl');
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
                await reversePosition(db, position, currentPrice, suggestion, 'reverse');
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
                await cancelPendingOrder(db, order.id, `ai_recommendation: ${decision.reason}`, order.binance_order_id);
                console.log(`[Scheduler][${method.name}] Cancelled pending order ${decision.order_id}: ${decision.reason}`);
              }
              
              // Handle modify
              else if (decision.action === 'modify') {
                // For testnet pending orders, need to sync with Binance
                if (order.binance_order_id) {
                  try {
                    const { cancelOrder, placeLimitOrder, getTestnetClient } = await import('./services/testnetEngine.js');
                    const { getSymbol } = await import('./config/binance.js');
                    const testnetClient = getTestnetClient();
                    
                    if (testnetClient) {
                      // Cancel old Binance limit order
                      await cancelOrder(testnetClient, getSymbol(), order.binance_order_id);
                      console.log(`[Scheduler][${method.name}] Cancelled old Binance limit order ${order.binance_order_id}`);
                      
                      // Place new Binance limit order with updated parameters
                      const newEntry = decision.new_entry || order.entry_price;
                      const newQty = decision.new_entry ? (order.size_usd / newEntry) : order.size_qty;
                      // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
                      const binanceSide = order.side === 'long' ? 'BUY' : 'SELL';
                      const positionSide = order.side === 'long' ? 'LONG' : 'SHORT';
                      const newLimitOrder = await placeLimitOrder(
                        testnetClient,
                        getSymbol(),
                        binanceSide,
                        newQty,
                        newEntry,
                        positionSide
                      );
                      const newBinanceOrderId = newLimitOrder.orderId.toString();
                      console.log(`[Scheduler][${method.name}] Placed new Binance limit order ${newBinanceOrderId}`);
                      
                      // Update database with new parameters and new binance_order_id
                      await modifyPendingOrder(db, order, decision.new_entry, decision.new_sl, decision.new_tp, newBinanceOrderId);
                      console.log(`[Scheduler][${method.name}] Modified testnet pending order ${decision.order_id}: ${decision.reason}`);
                    } else {
                      console.warn(`[Scheduler][${method.name}] Testnet client not available, only updating DB`);
                      await modifyPendingOrder(db, order, decision.new_entry, decision.new_sl, decision.new_tp);
                    }
                  } catch (binanceError) {
                    console.error(`[Scheduler][${method.name}] Failed to sync modify with Binance:`, binanceError.message);
                    // Continue to update DB even if Binance sync fails
                    await modifyPendingOrder(db, order, decision.new_entry, decision.new_sl, decision.new_tp);
                  }
                } else {
                  // No Binance order ID, just update DB
                  await modifyPendingOrder(db, order, decision.new_entry, decision.new_sl, decision.new_tp);
                  console.log(`[Scheduler][${method.name}] Modified pending order ${decision.order_id} (DB only): ${decision.reason}`);
                }
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

        // CRITICAL: Refresh open positions AFTER processing position decisions
        // This ensures auto-entry sees the correct state after closes/reverses
        const openPositions = await getPositions(db, { account_id: account.id, status: 'open' });
        console.log(`[Scheduler][${method.name}] Open positions after decisions: ${openPositions.length}`);
        
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
                console.log(`[Scheduler][${method.name}] Pending order size $${orderSizeUsd?.toFixed(2) || 'N/A'} exceeds max $${maxPendingOrderSize}, capping to $${maxPendingOrderSize}`);
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
        
        // Step 5: Testnet auto-entry (if enabled)
        if (process.env.BINANCE_ENABLED === 'true') {
          try {
            const { openTestnetPosition } = await import('./services/testnetEngine.js');
            const { getOrCreateTestnetAccount, getTestnetPositions } = await import('./db/testnetDatabase.js');

            // Get or create testnet account
            const testnetAccount = await getOrCreateTestnetAccount(db, 'BTC', methodId);

            // Get open testnet positions
            const openTestnetPositions = await getTestnetPositions(db, { account_id: testnetAccount.id, status: 'open' });

            // Evaluate auto-entry for testnet (reuse same logic)
            const testnetDecision = await evaluateAutoEntry(analysis.btc, testnetAccount, openTestnetPositions, method, db);

            console.log(`[Scheduler][${method.name}] Testnet decision: shouldEnter=${testnetDecision.shouldEnter}, orderType=${testnetDecision.orderType}, reason=${testnetDecision.reason}`);

            if (testnetDecision.shouldEnter && testnetDecision.suggestedPosition) {
              const position = testnetDecision.suggestedPosition;

              if (testnetDecision.orderType === 'market') {
                // Execute immediately as market order
                const positionWithMaxVolume = {
                  ...position,
                  maxVolumePerAccount: method.autoEntry.maxVolumePerAccount || 2000,
                };
                await openTestnetPosition(db, testnetAccount, positionWithMaxVolume, btcPredictionId, methodId);
                console.log(`[Scheduler][${method.name}] Testnet market order executed: ${position.side} @ ${position.entry_price}`);
              } else {
                // Create pending limit order for testnet
                const { createTestnetPendingOrder } = await import('./db/testnetDatabase.js');
                const { randomUUID } = await import('crypto');
                const { placeLimitOrder, getTestnetClient } = await import('./services/testnetEngine.js');
                const { getSymbol } = await import('./config/binance.js');

                // Cap pending order size at maxPendingOrderSize
                let orderSizeUsd = position.size_usd;
                let orderSizeQty = position.size_qty;
                const maxPendingOrderSize = method.autoEntry.maxPendingOrderSize || 2000;

                if (orderSizeUsd > maxPendingOrderSize) {
                  console.log(`[Scheduler][${method.name}] Testnet pending order size $${orderSizeUsd?.toFixed(2) || 'N/A'} exceeds max $${maxPendingOrderSize}, capping to $${maxPendingOrderSize}`);
                  orderSizeUsd = maxPendingOrderSize;
                  orderSizeQty = orderSizeUsd / position.entry_price;
                }

                // Place limit order on Binance
                let binanceOrderId = null;
                try {
                  const testnetClient = getTestnetClient();
                  if (testnetClient) {
                    // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
                    const binanceSide = position.side === 'long' ? 'BUY' : 'SELL';
                    const positionSide = position.side === 'long' ? 'LONG' : 'SHORT';
                    const limitOrder = await placeLimitOrder(
                      testnetClient,
                      getSymbol(),
                      binanceSide,
                      orderSizeQty,
                      position.entry_price,
                      positionSide
                    );
                    binanceOrderId = limitOrder.orderId.toString();
                    console.log(`[Scheduler][${method.name}] Binance limit order placed: ${binanceOrderId}`);
                  } else {
                    console.warn(`[Scheduler][${method.name}] Testnet client not available, skipping Binance limit order`);
                  }
                } catch (binanceError) {
                  console.error(`[Scheduler][${method.name}] Failed to place Binance limit order:`, binanceError.message);
                  // Continue to save to DB even if Binance order fails
                }

                await createTestnetPendingOrder(db, {
                  order_id: randomUUID(),
                  account_id: testnetAccount.id,
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
                  method_id: methodId,
                  binance_order_id: binanceOrderId
                });
                console.log(`[Scheduler][${method.name}] Testnet limit order created (pending): entry ${position.entry_price}, size $${orderSizeUsd?.toFixed(2) || 'N/A'}, binance_order_id: ${binanceOrderId}`);
              }
            }
          } catch (testnetError) {
            console.error(`[Scheduler][${method.name}] Testnet execution failed:`, testnetError.message);
            console.error(`[Scheduler][${method.name}] Testnet error stack:`, testnetError.stack);
          }
        } else {
          console.log(`[Scheduler][${method.name}] Testnet execution skipped: BINANCE_ENABLED=${process.env.BINANCE_ENABLED}`);
        }
        
        // Step 6: Testnet pending order decisions (if enabled)
        if (process.env.BINANCE_ENABLED === 'true' && analysis.btc?.pending_order_decisions && Array.isArray(analysis.btc.pending_order_decisions)) {
          try {
            const { cancelTestnetPendingOrder, getTestnetPendingOrders } = await import('./db/testnetDatabase.js');
            const { getMethodConfig } = await import('./config/methods.js');
            
            // Get method confidence threshold
            const methodConfig = getMethodConfig(methodId);
            const confidenceThreshold = (methodConfig.autoEntry?.minConfidence || 70) / 100;

            for (const decision of analysis.btc.pending_order_decisions) {
              // Check confidence threshold
              if (decision.confidence < confidenceThreshold) {
                console.log(`[Scheduler][${method.name}] Skipping testnet pending order decision for ${decision.order_id}: confidence ${decision.confidence} < threshold ${confidenceThreshold}`);
                continue;
              }
              
              // Handle hold action (do nothing)
              if (decision.action === 'hold') {
                console.log(`[Scheduler][${method.name}] Holding testnet pending order ${decision.order_id}: ${decision.reason}`);
                continue;
              }
              
              try {
                const pendingOrders = await getTestnetPendingOrders(db, { order_id: decision.order_id });
                const order = pendingOrders[0];
                if (!order || order.status !== 'pending') {
                  console.log(`[Scheduler][${method.name}] Testnet pending order ${decision.order_id} not found or not pending, skipping`);
                  continue;
                }
                
                // Handle cancel
                if (decision.action === 'cancel') {
                  await cancelTestnetPendingOrder(db, order.order_id, `ai_recommendation: ${decision.reason}`, order.binance_order_id);
                  console.log(`[Scheduler][${method.name}] Cancelled testnet pending order ${decision.order_id}: ${decision.reason}`);
                }
                
                // Handle modify
                else if (decision.action === 'modify') {
                  // For testnet pending orders, need to sync with Binance
                  if (order.binance_order_id) {
                    try {
                      const { cancelOrder, placeLimitOrder, getTestnetClient } = await import('./services/testnetEngine.js');
                      const { getSymbol } = await import('./config/binance.js');
                      const testnetClient = getTestnetClient();
                      
                      if (testnetClient) {
                        // Cancel old Binance limit order
                        await cancelOrder(testnetClient, getSymbol(), order.binance_order_id);
                        console.log(`[Scheduler][${method.name}] Cancelled old Binance limit order ${order.binance_order_id}`);
                        
                        // Place new Binance limit order with updated parameters
                        const newEntry = decision.new_entry || order.entry_price;
                        const newQty = decision.new_entry ? (order.size_usd / newEntry) : order.size_qty;
                        // Convert internal side format ('long'/'short') to Binance format ('BUY'/'SELL')
                        const binanceSide = order.side === 'long' ? 'BUY' : 'SELL';
                        const positionSide = order.side === 'long' ? 'LONG' : 'SHORT';
                        const newLimitOrder = await placeLimitOrder(
                          testnetClient,
                          getSymbol(),
                          binanceSide,
                          newQty,
                          newEntry,
                          positionSide
                        );
                        const newBinanceOrderId = newLimitOrder.orderId.toString();
                        console.log(`[Scheduler][${method.name}] Placed new Binance limit order ${newBinanceOrderId}`);
                        
                        // Update database with new parameters and new binance_order_id
                        const { updateTestnetPendingOrder } = await import('./db/testnetDatabase.js');
                        await updateTestnetPendingOrder(db, order.order_id, {
                          entry_price: newEntry,
                          stop_loss: decision.new_sl,
                          take_profit: decision.new_tp,
                          binance_order_id: newBinanceOrderId
                        });
                        console.log(`[Scheduler][${method.name}] Modified testnet pending order ${decision.order_id}: ${decision.reason}`);
                      } else {
                        console.warn(`[Scheduler][${method.name}] Testnet client not available, only updating DB`);
                        const { updateTestnetPendingOrder } = await import('./db/testnetDatabase.js');
                        await updateTestnetPendingOrder(db, order.order_id, {
                          entry_price: decision.new_entry,
                          stop_loss: decision.new_sl,
                          take_profit: decision.new_tp
                        });
                      }
                    } catch (binanceError) {
                      console.error(`[Scheduler][${method.name}] Failed to sync modify with Binance:`, binanceError.message);
                      // Continue to update DB even if Binance sync fails
                      const { updateTestnetPendingOrder } = await import('./db/testnetDatabase.js');
                      await updateTestnetPendingOrder(db, order.order_id, {
                        entry_price: decision.new_entry,
                        stop_loss: decision.new_sl,
                        take_profit: decision.new_tp
                      });
                    }
                  } else {
                    // No Binance order ID, just update DB
                    const { updateTestnetPendingOrder } = await import('./db/testnetDatabase.js');
                    await updateTestnetPendingOrder(db, order.order_id, {
                      entry_price: decision.new_entry,
                      stop_loss: decision.new_sl,
                      take_profit: decision.new_tp
                    });
                    console.log(`[Scheduler][${method.name}] Modified testnet pending order ${decision.order_id} (DB only): ${decision.reason}`);
                  }
                }
              } catch (error) {
                console.error(`[Scheduler][${method.name}] Failed to execute testnet pending order decision for ${decision.order_id}:`, error.message);
              }
            }
          } catch (testnetPendingDecisionError) {
            console.error(`[Scheduler][${method.name}] Testnet pending order decisions failed:`, testnetPendingDecisionError.message);
          }
        }
        
        // Step 7: Testnet position decisions (if enabled)
        if (process.env.BINANCE_ENABLED === 'true' && analysis.btc?.position_decisions && Array.isArray(analysis.btc.position_decisions)) {
          try {
            const { closeTestnetPositionEngine, updateTestnetPositionSL } = await import('./services/testnetEngine.js');
            const { getTestnetPosition } = await import('./db/testnetDatabase.js');
            const { fetchRealTimePrices } = await import('./price-fetcher.js');
            const { getMethodConfig } = await import('./config/methods.js');
            
            // Get method confidence threshold
            const methodConfig = getMethodConfig(methodId);
            const confidenceThreshold = (methodConfig.autoEntry?.minConfidence || 70) / 100;

            for (const decision of analysis.btc.position_decisions) {
              // Check confidence threshold
              if (decision.confidence < confidenceThreshold) {
                console.log(`[Scheduler][${method.name}] Skipping testnet position decision for ${decision.position_id}: confidence ${decision.confidence} < threshold ${confidenceThreshold}`);
                continue;
              }
              
              // Handle hold action (do nothing)
              if (decision.action === 'hold') {
                console.log(`[Scheduler][${method.name}] Holding testnet position ${decision.position_id}: ${decision.reason}`);
                continue;
              }
              
              try {
                const position = await getTestnetPosition(db, decision.position_id);
                if (!position || position.status !== 'open') {
                  console.log(`[Scheduler][${method.name}] Testnet position ${decision.position_id} not found or not open, skipping`);
                  continue;
                }
                
                const realtimePrices = await fetchRealTimePrices();
                const currentPrice = realtimePrices['btc']?.price || position.current_price;
                
                // Handle close_early (full close)
                if (decision.action === 'close_early') {
                  await closeTestnetPositionEngine(db, position, currentPrice, `ai_recommendation: ${decision.reason}`);
                  console.log(`[Scheduler][${method.name}] Closed testnet position ${decision.position_id} early: ${decision.reason}`);
                }
                
                // Handle close_partial
                else if (decision.action === 'close_partial') {
                  // Testnet doesn't support partial close yet, log for now
                  console.log(`[Scheduler][${method.name}] Partial close not yet supported for testnet position ${decision.position_id}: ${decision.reason}`);
                }
                
                // Handle move_sl
                else if (decision.action === 'move_sl') {
                  const newSl = decision.new_sl;
                  if (newSl) {
                    await updateTestnetPositionSL(db, position, newSl, `ai_recommendation: ${decision.reason}`);
                    console.log(`[Scheduler][${method.name}] Moved SL for testnet position ${decision.position_id} to ${newSl}: ${decision.reason}`);
                  }
                }
                
                // Handle reverse
                else if (decision.action === 'reverse') {
                  // Testnet doesn't support reverse yet, log for now
                  console.log(`[Scheduler][${method.name}] Reverse not yet supported for testnet position ${decision.position_id}: ${decision.reason}`);
                }
              } catch (error) {
                console.error(`[Scheduler][${method.name}] Failed to execute testnet position decision for ${decision.position_id}:`, error.message);
              }
            }
          } catch (testnetDecisionError) {
            console.error(`[Scheduler][${method.name}] Testnet position decisions failed:`, testnetDecisionError.message);
          }
        }
        
        console.log(`[Scheduler][${method.name}] Analysis complete - Account: ${account.id}, Balance: $${account.current_balance?.toFixed(2) || 'N/A'}`);
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
