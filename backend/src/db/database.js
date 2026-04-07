import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use absolute path and ensure directory exists
const DATA_DIR = join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'predictions.db');

// Initialize database
export async function initDatabase() {
  try {
    // Ensure data directory exists
    await mkdir(DATA_DIR, { recursive: true });
    console.log('[Database] Data directory ensured:', DATA_DIR);
  } catch (err) {
    console.error('[Database] Error creating data directory:', err.message);
  }

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('[Database] Error opening database:', err.message);
        console.error('[Database] Database path:', DB_PATH);
        reject(err);
        return;
      }
      console.log('[Database] Connected to SQLite database at:', DB_PATH);
      
      // Create tables
      db.serialize(() => {
        // Analysis history - stores each analysis run
        db.run(`
          CREATE TABLE IF NOT EXISTS analysis_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            current_price REAL NOT NULL,
            bias TEXT NOT NULL,
            action TEXT NOT NULL,
            confidence REAL NOT NULL,
            narrative TEXT,
            comparison TEXT,
            market_sentiment TEXT,
            disclaimer TEXT
          )
        `);
        
        // Predictions - stores individual timeframe predictions
        db.run(`
          CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id INTEGER NOT NULL,
            coin TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            direction TEXT NOT NULL,
            target_price REAL,
            confidence REAL,
            predicted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            actual_price REAL,
            accuracy REAL,
            is_correct BOOLEAN,
            FOREIGN KEY (analysis_id) REFERENCES analysis_history(id)
          )
        `);
        
        // Key levels - stores ICT key levels for each analysis
        db.run(`
          CREATE TABLE IF NOT EXISTS key_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id INTEGER NOT NULL,
            coin TEXT NOT NULL,
            level_type TEXT NOT NULL,
            description TEXT,
            price_levels TEXT,
            FOREIGN KEY (analysis_id) REFERENCES analysis_history(id)
          )
        `);
        
        // OHLCV candles - stores 15-minute candles (primary data source)
        db.run(`
          CREATE TABLE IF NOT EXISTS ohlcv_candles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            timeframe TEXT DEFAULT '15m',
            UNIQUE(coin, timestamp, timeframe)
          )
        `);
        
        // Latest prices - stores most recent price for quick access
        db.run(`
          CREATE TABLE IF NOT EXISTS latest_prices (
            coin TEXT PRIMARY KEY,
            price REAL NOT NULL,
            change_24h REAL,
            change_7d REAL,
            market_cap REAL,
            volume_24h REAL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        // Price history - stores actual prices for validation (legacy, kept for compatibility)
        db.run(`
          CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        // Create indexes for performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_ohlcv_coin_time ON ohlcv_candles(coin, timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_ohlcv_timeframe ON ohlcv_candles(coin, timeframe, timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_analysis ON predictions(analysis_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_coin_time ON predictions(coin, predicted_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_coin_time ON price_history(coin, timestamp)`);
        
        console.log('[Database] Tables initialized successfully');
        resolve(db);
      });
    });
  });
}

// Save analysis and predictions
export async function saveAnalysis(db, coin, priceData, analysis) {
  return new Promise((resolve, reject) => {
    const coinData = analysis[coin.toLowerCase()];
    if (!coinData) {
      reject(new Error(`No analysis data for ${coin}`));
      return;
    }
    
    const currentPrice = priceData[coin.toLowerCase()]?.price || 0;
    
    db.run(
      `INSERT INTO analysis_history 
       (coin, current_price, bias, action, confidence, narrative, comparison, market_sentiment, disclaimer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        coin.toUpperCase(),
        currentPrice,
        coinData.bias,
        coinData.action,
        coinData.confidence,
        coinData.narrative,
        analysis.comparison,
        analysis.marketSentiment,
        analysis.disclaimer
      ],
      function(err) {
        if (err) {
          console.error('[Database] Error saving analysis:', err.message);
          reject(err);
          return;
        }
        
        const analysisId = this.lastID;
        
        // Save predictions
        if (coinData.predictions) {
          const predictions = Object.entries(coinData.predictions);
          const timeframeHours = { '15m': 0.25, '1h': 1, '4h': 4, '1d': 24 };
          
          predictions.forEach(([timeframe, pred]) => {
            // Skip if pred is undefined or missing required properties
            if (!pred || typeof pred !== 'object') return;
            
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + timeframeHours[timeframe]);
            
            db.run(
              `INSERT INTO predictions 
               (analysis_id, coin, timeframe, direction, target_price, confidence, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                analysisId,
                coin.toUpperCase(),
                timeframe,
                pred.direction || 'neutral',
                pred.target || 0,
                pred.confidence || 0,
                expiresAt.toISOString()
              ]
            );
          });
        }
        
        // Save key levels
        if (coinData.key_levels) {
          Object.entries(coinData.key_levels).forEach(([type, desc]) => {
            db.run(
              `INSERT INTO key_levels 
               (analysis_id, coin, level_type, description)
               VALUES (?, ?, ?, ?)`,
              [analysisId, coin.toUpperCase(), type, desc]
            );
          });
        }
        
        // Save current price
        db.run(
          `INSERT INTO price_history (coin, price) VALUES (?, ?)`,
          [coin.toUpperCase(), currentPrice]
        );
        
        console.log(`[Database] Saved analysis #${analysisId} for ${coin}`);
        resolve(analysisId);
      }
    );
  });
}

// Get prediction accuracy
export async function getPredictionAccuracy(db, coin, hours = 24) {
  return new Promise((resolve, reject) => {
    const since = new Date();
    since.setHours(since.getHours() - hours);
    
    db.all(
      `SELECT p.*, ah.current_price as entry_price
       FROM predictions p
       JOIN analysis_history ah ON p.analysis_id = ah.id
       WHERE p.coin = ? 
       AND p.predicted_at > ?
       AND p.actual_price IS NOT NULL
       ORDER BY p.predicted_at DESC`,
      [coin.toUpperCase(), since.toISOString()],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        const stats = {
          total: rows.length,
          correct: rows.filter(r => r.is_correct).length,
          accuracy: rows.length > 0 ? rows.filter(r => r.is_correct).length / rows.length : 0,
          byTimeframe: {}
        };
        
        rows.forEach(row => {
          if (!stats.byTimeframe[row.timeframe]) {
            stats.byTimeframe[row.timeframe] = { total: 0, correct: 0 };
          }
          stats.byTimeframe[row.timeframe].total++;
          if (row.is_correct) {
            stats.byTimeframe[row.timeframe].correct++;
          }
        });
        
        resolve(stats);
      }
    );
  });
}

// Update prediction with actual price (for cron job)
export async function validatePredictions(db) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.all(
      `SELECT p.*, ah.current_price as entry_price
       FROM predictions p
       JOIN analysis_history ah ON p.analysis_id = ah.id
       WHERE p.expires_at <= ? 
       AND p.actual_price IS NULL`,
      [now],
      async (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        for (const pred of rows) {
          // Get actual price at expiration time
          const actualPrice = await getPriceAtTime(db, pred.coin, pred.expires_at);
          
          if (actualPrice) {
            const predictedUp = pred.direction === 'up';
            const actualUp = actualPrice > pred.entry_price;
            const isCorrect = predictedUp === actualUp;
            
            db.run(
              `UPDATE predictions 
               SET actual_price = ?, is_correct = ?, accuracy = ?
               WHERE id = ?`,
              [
                actualPrice,
                isCorrect,
                isCorrect ? 1 : 0,
                pred.id
              ]
            );
          }
        }
        
        console.log(`[Database] Validated ${rows.length} predictions`);
        resolve(rows.length);
      }
    );
  });
}

// Get price closest to a timestamp using OHLCV candles for accuracy
async function getPriceAtTime(db, coin, timestamp) {
  return new Promise((resolve, reject) => {
    // Try OHLCV candles first (more accurate - 15m granularity)
    const targetTimestamp = new Date(timestamp).toISOString();
    
    db.get(
      `SELECT close FROM ohlcv_candles 
       WHERE coin = ? AND timeframe = '15m' 
       ORDER BY ABS(strftime('%s', timestamp) - strftime('%s', ?)) ASC 
       LIMIT 1`,
      [coin.toUpperCase(), targetTimestamp],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (row?.close) {
          resolve(row.close);
          return;
        }
        
        // Fallback to price_history if OHLCV not available
        console.log(`[Database] OHLCV not available for ${coin} at ${targetTimestamp}, using price_history fallback`);
        db.get(
          `SELECT price FROM price_history 
           WHERE coin = ? AND timestamp <= ? 
           ORDER BY timestamp DESC LIMIT 1`,
          [coin.toUpperCase(), timestamp],
          (err2, row2) => {
            if (err2) reject(err2);
            else resolve(row2?.price || null);
          }
        );
      }
    );
  });
}

// Get recent analysis with predictions for chart overlay
export async function getRecentAnalysisWithPredictions(db, coin, limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
        ah.*,
        json_group_array(
          json_object(
            'timeframe', p.timeframe,
            'direction', p.direction,
            'target', p.target_price,
            'confidence', p.confidence,
            'actual', p.actual_price,
            'is_correct', p.is_correct
          )
        ) as predictions
       FROM analysis_history ah
       LEFT JOIN predictions p ON ah.id = p.analysis_id
       WHERE ah.coin = ?
       GROUP BY ah.id
       ORDER BY ah.timestamp DESC
       LIMIT ?`,
      [coin.toUpperCase(), limit],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        const results = rows.map(row => ({
          ...row,
          predictions: JSON.parse(row.predictions || '[]').filter(p => p.timeframe)
        }));
        
        resolve(results);
      }
    );
  });
}

// Close database connection
export function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else {
        console.log('[Database] Connection closed');
        resolve();
      }
    });
  });
}

// ==========================================
// OHLCV CANDLE FUNCTIONS
// ==========================================

// Save or update OHLCV candle with specific timeframe
export async function saveOHLCCandleWithTimeframe(db, coin, timestamp, open, high, low, close, volume = null, timeframe = '15m') {
  return new Promise((resolve, reject) => {
    // Use timestamp as-is for proper time ordering
    const candleTimestamp = new Date(timestamp).toISOString();
    
    db.run(
      `INSERT OR REPLACE INTO ohlcv_candles 
       (coin, timestamp, open, high, low, close, volume, timeframe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [coin.toUpperCase(), candleTimestamp, open, high, low, close, volume, timeframe],
      function(err) {
        if (err) {
          console.error('[Database] Error saving OHLCV:', err.message);
          reject(err);
          return;
        }
        resolve(this.lastID);
      }
    );
  });
}

// Save or update OHLCV candle
export async function saveOHLCCandle(db, coin, timestamp, open, high, low, close, volume = null) {
  return saveOHLCCandleWithTimeframe(db, coin, timestamp, open, high, low, close, volume, '15m');
}

// Get OHLCV candles for a time range
export async function getOHLCCandles(db, coin, hoursBack = 168, timeframe = '15m') {
  return new Promise((resolve, reject) => {
    const since = new Date();
    since.setHours(since.getHours() - hoursBack);
    
    db.all(
      `SELECT * FROM ohlcv_candles 
       WHERE coin = ? AND timeframe = ? AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [coin.toUpperCase(), timeframe, since.toISOString()],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      }
    );
  });
}

// Get latest OHLCV candle
export async function getLatestOHLCCandle(db, coin, timeframe = '15m') {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM ohlcv_candles 
       WHERE coin = ? AND timeframe = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [coin.toUpperCase(), timeframe],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row);
      }
    );
  });
}

// Save latest price
export async function saveLatestPrice(db, coin, price, change24h, change7d, marketCap, volume24h = 0) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO latest_prices 
       (coin, price, change_24h, change_7d, market_cap, volume_24h, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [coin.toUpperCase(), price, change24h, change7d, marketCap, volume24h],
      function(err) {
        if (err) {
          console.error('[Database] Error saving latest price:', err.message);
          reject(err);
          return;
        }
        resolve(this.lastID);
      }
    );
  });
}

// Get latest price
export async function getLatestPrice(db, coin) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM latest_prices WHERE coin = ?`,
      [coin.toUpperCase()],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row);
      }
    );
  });
}

// DEPRECATED: This function creates fake interpolated data and should not be used
// Use real OHLC data from API instead (e.g., CoinGecko OHLC endpoint)
/*
export async function saveSparklineAsOHLCCandles(db, coin, sparklinePrices, endTimestamp) {
  if (!sparklinePrices || sparklinePrices.length < 2) return;
  
  // Sparkline from CoinGecko is typically 168 points (7 days) with roughly hourly data
  // We need to convert to 15-minute candles
  
  // Create more granular data by interpolating between points
  const interpolatedPrices = [];
  for (let i = 0; i < sparklinePrices.length - 1; i++) {
    const start = sparklinePrices[i];
    const end = sparklinePrices[i + 1];
    interpolatedPrices.push(start);
    
    // Add 3 intermediate points between each hour to get 15-min data
    for (let j = 1; j <= 3; j++) {
      const ratio = j / 4;
      interpolatedPrices.push(start + (end - start) * ratio);
    }
  }
  interpolatedPrices.push(sparklinePrices[sparklinePrices.length - 1]);
  
  // Group into 15-minute candles using sliding window
  const ohlcCandles = [];
  const windowSize = 4; // Use 4 points to create proper OHLC
  
  for (let i = 0; i < interpolatedPrices.length - windowSize + 1; i += windowSize) {
    const window = interpolatedPrices.slice(i, i + windowSize);
    if (window.length < windowSize) continue;
    
    const open = window[0];
    const close = window[window.length - 1];
    const high = Math.max(...window);
    const low = Math.min(...window);
    
    // Calculate timestamp for this candle (working backwards from end)
    const candleIndex = Math.floor(i / windowSize);
    const candleTime = new Date(endTimestamp);
    candleTime.setMinutes(candleTime.getMinutes() - (candleIndex * 15));
    
    try {
      await saveOHLCCandle(db, coin, candleTime, open, high, low, close);
      ohlcCandles.push({ timestamp: candleTime, open, high, low, close });
    } catch (err) {
      console.error(`[Database] Failed to save candle for ${coin}:`, err.message);
    }
  }
  
  console.log(`[Database] Saved ${ohlcCandles.length} OHLCV candles for ${coin}`);
  return ohlcCandles;
}
*/

// ==========================================
// DATA RETENTION - DELETE OLD 15M CANDLES
// ==========================================

// Delete 15m candles older than 30 days (keep only recent 30 days of 15m data)
export async function cleanupOldCandles(db, coin) {
  return new Promise(async (resolve, reject) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    try {
      // Delete old 15m candles (older than 30 days)
      const result = await new Promise((res, rej) => {
        db.run(
          `DELETE FROM ohlcv_candles 
           WHERE coin = ? AND timeframe = '15m' 
           AND timestamp < ?`,
          [coin.toUpperCase(), thirtyDaysAgo.toISOString()],
          function(err) {
            if (err) rej(err);
            else res(this.changes);
          }
        );
      });
      
      if (result > 0) {
        console.log(`[Database] Deleted ${result} old 15m candles for ${coin} (older than 30 days)`);
      } else {
        console.log(`[Database] No old 15m candles to delete for ${coin}`);
      }
      
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}

// Run data retention cleanup (call this daily)
export async function runDataRetention(db) {
  console.log('[Database] Running data retention cleanup...');
  try {
    await cleanupOldCandles(db, 'BTC');
    await cleanupOldCandles(db, 'ETH');
    console.log('[Database] Data retention complete - kept only last 30 days of 15m candles');
  } catch (error) {
    console.error('[Database] Data retention error:', error.message);
  }
}
