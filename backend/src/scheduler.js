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
        const { saveAnalysis, getPositions, evaluateAutoEntry } = await import('./db/database.js');
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
        const decision = evaluateAutoEntry(analysis.btc, account, openPositions, method.autoEntry);
        
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

async function runAnalysisJob() {
  const startTime = Date.now();
  console.log(`\n[Job ${formatVietnamTime(new Date())}] Starting analysis job...`);
  
  try {
    // Step 1: Fetch price data (with database)
    const priceData = await fetchPrices(db);
    
    // Step 1b: Save OHLC data to database
    if (dbEnabled && db && priceData) {
      try {
        const { fetchOHLCFromBinance } = await import('./price-fetcher.js');
        const { saveOHLCCandleWithTimeframe, saveLatestPrice } = await import('./db/database.js');
        
        // Fetch real OHLC data from Binance (15m granularity for ICT analysis)
        const btcOHLC = await fetchOHLCFromBinance('BTCUSDT', '15m', 672); // 7 days
        const ethOHLC = await fetchOHLCFromBinance('ETHUSDT', '15m', 672);
        
        if (btcOHLC.length > 0) {
          let savedCount = 0;
          for (const candle of btcOHLC) {
            try {
              await saveOHLCCandleWithTimeframe(db, 'BTC', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
              savedCount++;
            } catch (saveError) {
              console.error(`[Scheduler] Failed to save BTC candle at ${candle.timestamp}:`, saveError.message);
            }
          }
          console.log(`[Scheduler] Saved ${savedCount}/${btcOHLC.length} BTC OHLC candles (15m) from Binance`);
        }
        
        if (ethOHLC.length > 0) {
          let savedCount = 0;
          for (const candle of ethOHLC) {
            try {
              await saveOHLCCandleWithTimeframe(db, 'ETH', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
              savedCount++;
            } catch (saveError) {
              console.error(`[Scheduler] Failed to save ETH candle at ${candle.timestamp}:`, saveError.message);
            }
          }
          console.log(`[Scheduler] Saved ${savedCount}/${ethOHLC.length} ETH OHLC candles (15m) from Binance`);
        }
        
        // Save latest prices
        await saveLatestPrice(db, 'BTC', priceData.btc.price, priceData.btc.change24h, priceData.btc.change7d, priceData.btc.marketCap, priceData.btc.volume24h);
        await saveLatestPrice(db, 'ETH', priceData.eth.price, priceData.eth.change24h, priceData.eth.change7d, priceData.eth.marketCap, priceData.eth.volume24h);
      } catch (saveError) {
        console.log('[Scheduler] OHLC save failed:', saveError.message);
      }
    }
    
    // Step 2: Groq Analysis
    const analysis = await analyzeWithGroq(priceData, db);
    
    // Step 3: Cache results
    const cachedData = {
      prices: priceData,
      analysis: analysis,
      lastUpdated: priceData.timestamp
    };
    cache.set(cachedData);
    
    // Step 4: Save to database for prediction tracking (optional)
    if (dbEnabled && db) {
      try {
        const { saveAnalysis, getOrCreateAccount, getPositions } = await import('./db/database.js');
        const { evaluateAutoEntry } = await import('./services/autoEntryLogic.js');
        const { openPosition } = await import('./services/paperTradingEngine.js');
        
        // Save analysis for BTC - returns { analysisId, predictionIds }
        const btcResult = await saveAnalysis(db, 'BTC', priceData, analysis);
        const btcPredictionId = btcResult.predictionIds?.['4h'] || btcResult.predictionIds?.['1d'];
        
        // Save analysis for ETH - returns { analysisId, predictionIds }
        const ethResult = await saveAnalysis(db, 'ETH', priceData, analysis);
        const ethPredictionId = ethResult.predictionIds?.['4h'] || ethResult.predictionIds?.['1d'];
        
        // Check for prediction reversals and close positions if needed (BTC only)
        if (analysis.btc && btcResult.analysisId) {
          try {
            const { checkPredictionReversal } = await import('./services/paperTradingEngine.js');
            const reversalResult = await checkPredictionReversal(db, analysis.btc, 'BTC');
            
            if (reversalResult.closed.length > 0) {
              console.log(`[Scheduler] Prediction reversal check closed ${reversalResult.closed.length} BTC positions`);
              reversalResult.closed.forEach(closed => {
                const pnlDisplay = closed.pnl !== undefined && closed.pnl !== null ? closed.pnl.toFixed(2) : 'N/A';
                console.log(`[Scheduler] - Position ${closed.position_id}: ${closed.reason}, PnL: $${pnlDisplay}, Win: ${closed.is_win}`);
              });
            } else if (reversalResult.reason) {
              console.log(`[Scheduler] Prediction reversal check: ${reversalResult.reason}`);
            } else {
              console.log(`[Scheduler] Prediction reversal check: ${reversalResult.checked} positions checked, no reversals detected`);
            }
          } catch (reversalError) {
            console.error('[Scheduler] Error during prediction reversal check:', reversalError.message);
          }
        }
        
        // Auto-entry evaluation for BTC
        const btcAccount = await getOrCreateAccount(db, 'BTC', 100);
        const btcOpenPositions = await getPositions(db, { symbol: 'BTC', status: 'open' });
        const btcDecision = evaluateAutoEntry(analysis.btc, btcAccount, btcOpenPositions);
        
        console.log(`[Scheduler] BTC auto-entry decision: ${btcDecision.action} - ${btcDecision.reason}`);
        
        if (btcDecision.shouldEnter && btcDecision.suggestedPosition) {
          try {
            const position = btcDecision.suggestedPosition;
            console.log(`[Scheduler] BTC order: type=${btcDecision.orderType}, side=${position.side}, entry=${position.entry_price}, current_price=${analysis.btc.current_price}, SL=${position.stop_loss}, TP=${position.take_profit}`);

            if (btcDecision.orderType === 'market') {
              // Execute immediately as market order
              const { openPosition } = await import('./services/paperTradingEngine.js');
              await openPosition(db, btcAccount, position, btcPredictionId);
              console.log(`[Scheduler] BTC market order executed immediately at ${position.entry_price}`);
            } else {
              // Create pending limit order
              const { createPendingOrder } = await import('./db/database.js');
              const { randomUUID } = await import('crypto');
              await createPendingOrder(db, {
                order_id: randomUUID(),
                account_id: btcAccount.id,
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
                invalidation_level: position.invalidation_level
              });
              console.log(`[Scheduler] BTC limit order created (pending): entry ${position.entry_price}`);
            }
          } catch (posError) {
            console.error(`[Scheduler] Failed to process BTC order:`, posError.message);
          }
        }
        
        // Auto-entry evaluation for ETH
        const ethAccount = await getOrCreateAccount(db, 'ETH', 100);
        const ethOpenPositions = await getPositions(db, { symbol: 'ETH', status: 'open' });
        const ethDecision = evaluateAutoEntry(analysis.eth, ethAccount, ethOpenPositions);
        
        console.log(`[Scheduler] ETH auto-entry decision: ${ethDecision.action} - ${ethDecision.reason}`);
        
        if (ethDecision.shouldEnter && ethDecision.suggestedPosition) {
          try {
            const position = ethDecision.suggestedPosition;
            console.log(`[Scheduler] ETH order: type=${ethDecision.orderType}, side=${position.side}, entry=${position.entry_price}, current_price=${analysis.eth.current_price}, SL=${position.stop_loss}, TP=${position.take_profit}`);

            if (ethDecision.orderType === 'market') {
              // Execute immediately as market order
              const { openPosition } = await import('./services/paperTradingEngine.js');
              await openPosition(db, ethAccount, position, ethPredictionId);
              console.log(`[Scheduler] ETH market order executed immediately at ${position.entry_price}`);
            } else {
              // Create pending limit order
              const { createPendingOrder } = await import('./db/database.js');
              const { randomUUID } = await import('crypto');
              await createPendingOrder(db, {
                order_id: randomUUID(),
                account_id: ethAccount.id,
                symbol: 'ETH',
                side: position.side,
                entry_price: position.entry_price,
                stop_loss: position.stop_loss,
                take_profit: position.take_profit,
                size_usd: position.size_usd,
                size_qty: position.size_qty,
                risk_usd: position.risk_usd,
                risk_percent: position.risk_percent,
                expected_rr: position.expected_rr,
                linked_prediction_id: ethPredictionId,
                invalidation_level: position.invalidation_level
              });
              console.log(`[Scheduler] ETH limit order created (pending): entry ${position.entry_price}`);
            }
          } catch (posError) {
            console.error(`[Scheduler] Failed to process ETH order:`, posError.message);
          }
        }
        
      } catch (dbError) {
        console.error('[Scheduler] Database save error:', dbError.message);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Job] Completed in ${duration}ms\n`);
    
  } catch (error) {
    console.error('[Job] Failed:', error.message);
    console.log('[Job] Will retry in next scheduled run\n');
  }
}
