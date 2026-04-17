import cron from 'node-cron';
import { fetchPrices } from './price-fetcher.js';
import { analyzeWithGroq } from './groqAnalyzer.js';
import { cache } from './cache.js';

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
    // Dynamically import to avoid startup failure if sqlite3 not installed
    const { initDatabase } = await import('./db/database.js');
    const { runMigrations } = await import('./db/migrations.js');
    db = await initDatabase();
    await runMigrations(db);
    dbEnabled = true;
    console.log('[Scheduler] Database initialized and migrations run');
  } catch (error) {
    console.log('[Scheduler] Database not available:', error.message);
    console.log('[Scheduler] Running without database persistence');
    db = null;
    dbEnabled = false;
  }
}

// Run analysis job every 15 minutes
export async function startScheduler() {
  console.log('[Scheduler] Starting 15-minute job scheduler...');
  
  // Initialize database
  await initDb();
  
  // Run immediately on startup
  runAnalysisJob();
  
  // Schedule: every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    console.log('[Scheduler] Triggering scheduled analysis...');
    runAnalysisJob();
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
  
  console.log('[Scheduler] Scheduled job registered (*/15 * * * *)');
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
          for (const candle of btcOHLC) {
            await saveOHLCCandleWithTimeframe(db, 'BTC', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
          }
          console.log(`[Scheduler] Saved ${btcOHLC.length} BTC OHLC candles (15m) from Binance`);
        }
        
        if (ethOHLC.length > 0) {
          for (const candle of ethOHLC) {
            await saveOHLCCandleWithTimeframe(db, 'ETH', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
          }
          console.log(`[Scheduler] Saved ${ethOHLC.length} ETH OHLC candles (15m) from Binance`);
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
                console.log(`[Scheduler] - Position ${closed.position_id}: ${closed.reason}, PnL: $${closed.pnl.toFixed(2)}, Win: ${closed.is_win}`);
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
            const { createPendingOrder } = await import('./db/database.js');
            const { randomUUID } = await import('crypto');
            
            // All orders are now limit orders - create pending order and wait for price to reach entry
            const position = btcDecision.suggestedPosition;
            console.log(`[Scheduler] BTC limit order created: side=${position.side}, entry=${position.entry_price}, current_price=${analysis.btc.current_price}, SL=${position.stop_loss}, TP=${position.take_profit}`);
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
            const { createPendingOrder } = await import('./db/database.js');
            const { randomUUID } = await import('crypto');
            
            // All orders are now limit orders - create pending order and wait for price to reach entry
            const position = ethDecision.suggestedPosition;
            console.log(`[Scheduler] ETH limit order created: side=${position.side}, entry=${position.entry_price}, current_price=${analysis.eth.current_price}, SL=${position.stop_loss}, TP=${position.take_profit}`);
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
