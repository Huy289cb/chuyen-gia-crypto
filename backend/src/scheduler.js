import cron from 'node-cron';
import { fetchPrices } from './price-fetcher.js';
import { analyzeWithGroq } from './groqAnalyzer.js';
import { cache } from './cache.js';

let db = null;
let dbEnabled = false;

// Initialize database on startup (optional)
async function initDb() {
  try {
    // Dynamically import to avoid startup failure if sqlite3 not installed
    const { initDatabase } = await import('./db/database.js');
    db = await initDatabase();
    dbEnabled = true;
    console.log('[Scheduler] Database initialized');
  } catch (error) {
    console.log('[Scheduler] Database not available:', error.message);
    console.log('[Scheduler] Running without database persistence');
    db = null;
    dbEnabled = false;
  }
}

// Run analysis job every 15 minutes
export function startScheduler() {
  console.log('[Scheduler] Starting 15-minute job scheduler...');
  
  // Initialize database
  initDb();
  
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
  
  console.log('[Scheduler] Scheduled job registered (*/15 * * * *)');
}

async function runAnalysisJob() {
  const startTime = Date.now();
  console.log(`\n[Job ${new Date().toISOString()}] Starting analysis job...`);
  
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
    const analysis = await analyzeWithGroq(priceData);
    
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
        const { saveAnalysis } = await import('./db/database.js');
        await saveAnalysis(db, 'BTC', priceData, analysis);
        await saveAnalysis(db, 'ETH', priceData, analysis);
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
