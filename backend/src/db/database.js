import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper for Promise.all with timeout to prevent hanging
const promiseAllWithTimeout = (promises, timeoutMs = 30000) => {
  return Promise.race([
    Promise.all(promises),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Promise.all timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

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
            disclaimer TEXT,
            method_id TEXT DEFAULT 'ict',
            breakout_retest TEXT,
            position_decisions TEXT,
            alternative_scenario TEXT
          )
        `, (err) => {
          if (err) console.error('[Database] Error creating analysis_history table:', err.message);
        });
        
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
            outcome TEXT,
            pnl REAL DEFAULT 0,
            hit_tp INTEGER DEFAULT 0,
            hit_sl INTEGER DEFAULT 0,
            linked_position_id INTEGER,
            suggested_entry REAL,
            suggested_stop_loss REAL,
            suggested_take_profit REAL,
            expected_rr REAL,
            invalidation_level REAL,
            reason_summary TEXT,
            model_version TEXT DEFAULT '1.0',
            FOREIGN KEY (analysis_id) REFERENCES analysis_history(id)
          )
        `, (err) => {
          if (err) console.error('[Database] Error creating predictions table:', err.message);
        });
        
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
        `, (err) => {
          if (err) console.error('[Database] Error creating key_levels table:', err.message);
        });
        
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
        `, (err) => {
          if (err) console.error('[Database] Error creating ohlcv_candles table:', err.message);
        });
        
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
        `, (err) => {
          if (err) console.error('[Database] Error creating latest_prices table:', err.message);
        });
        
        // Price history - stores actual prices for validation (legacy, kept for compatibility)
        db.run(`
          CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) console.error('[Database] Error creating price_history table:', err.message);
        });
        
        // Create indexes for performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_ohlcv_coin_time ON ohlcv_candles(coin, timestamp)`, (err) => {
          if (err) console.error('[Database] Error creating idx_ohlcv_coin_time index:', err.message);
        });
        db.run(`CREATE INDEX IF NOT EXISTS idx_ohlcv_timeframe ON ohlcv_candles(coin, timeframe, timestamp)`, (err) => {
          if (err) console.error('[Database] Error creating idx_ohlcv_timeframe index:', err.message);
        });
        db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_analysis ON predictions(analysis_id)`, (err) => {
          if (err) console.error('[Database] Error creating idx_predictions_analysis index:', err.message);
        });
        db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_coin_time ON predictions(coin, predicted_at)`, (err) => {
          if (err) console.error('[Database] Error creating idx_predictions_coin_time index:', err.message);
        });
        db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_coin_time ON price_history(coin, timestamp)`, (err) => {
          if (err) console.error('[Database] Error creating idx_price_history_coin_time index:', err.message);
        });
        
        console.log('[Database] Tables initialized successfully');
        
        // Run migrations to add paper trading tables and method_id columns
        (async () => {
          try {
            const { runMigrations } = await import('./migrations.js');
            await runMigrations(db);
            resolve(db);
          } catch (migrationError) {
            console.error('[Database] Migration failed:', migrationError.message);
            // Still resolve db even if migration fails to allow app to start
            resolve(db);
          }
        })();
      });
    });
  });
}

// Save analysis and predictions
export async function saveAnalysis(db, coin, priceData, analysis, methodId = 'ict') {
  return new Promise((resolve, reject) => {
    const coinData = analysis[coin.toLowerCase()];
    if (!coinData) {
      reject(new Error(`No analysis data for ${coin}`));
      return;
    }
    
    const currentPrice = priceData[coin.toLowerCase()]?.price || 0;
    
    console.log(`[Database] Saving analysis for ${coin} (method: ${methodId}): currentPrice=${currentPrice}, bias=${coinData.bias}, confidence=${coinData.confidence}`);
    
    db.run(
      `INSERT INTO analysis_history 
       (coin, current_price, bias, action, confidence, narrative, comparison, market_sentiment, disclaimer, method_id, breakout_retest, position_decisions, alternative_scenario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        coin.toUpperCase(),
        currentPrice,
        coinData.bias,
        coinData.action,
        coinData.confidence,
        coinData.narrative,
        analysis.comparison,
        analysis.marketSentiment,
        analysis.disclaimer,
        methodId,
        coinData.breakout_retest ? JSON.stringify(coinData.breakout_retest) : null,
        coinData.position_decisions ? JSON.stringify(coinData.position_decisions) : null,
        coinData.alternative_scenario ? JSON.stringify(coinData.alternative_scenario) : null
      ],
      function(err) {
        if (err) {
          console.error('[Database] Error saving analysis:', err.message);
          reject(err);
          return;
        }
        
        const analysisId = this.lastID;
        
        // Save predictions with new trading suggestion fields (async)
        // Collect prediction IDs for linking with positions
        const predictionIds = {};
        const savePredictions = async () => {
          if (coinData.predictions) {
            const predictions = Object.entries(coinData.predictions);
            const timeframeHours = { '15m': 0.25, '1h': 1, '4h': 4, '1d': 24 };
            
            for (const [timeframe, pred] of predictions) {
              // Skip if pred is undefined or missing required properties
              if (!pred || typeof pred !== 'object') continue;
              
              const expiresAt = new Date();
              expiresAt.setHours(expiresAt.getHours() + timeframeHours[timeframe]);
              
              const predictionId = await new Promise((res, rej) => {
                db.run(
                  `INSERT INTO predictions 
                   (analysis_id, coin, timeframe, direction, target_price, confidence, predicted_at, expires_at, 
                    suggested_entry, suggested_stop_loss, suggested_take_profit, expected_rr, 
                    invalidation_level, reason_summary, model_version, method_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    analysisId,
                    coin.toUpperCase(),
                    timeframe,
                    pred.direction || 'neutral',
                    pred.target || 0,
                    pred.confidence || 0,
                    new Date().toISOString(),
                    expiresAt.toISOString(),
                    coinData.suggested_entry || null,
                    coinData.suggested_stop_loss || null,
                    coinData.suggested_take_profit || null,
                    coinData.expected_rr || null,
                    coinData.invalidation_level || null,
                    coinData.reason_summary || null,
                    '1.0',
                    methodId
                  ],
                  function(insertErr) {
                    if (insertErr) rej(insertErr);
                    else res(this.lastID);
                  }
                );
              });
              
              // Store prediction ID for linking with positions
              predictionIds[timeframe] = predictionId;
            }
          }
        };
        
        // Save key levels (async)
        const saveKeyLevels = async () => {
          if (coinData.key_levels) {
            for (const [type, desc] of Object.entries(coinData.key_levels)) {
              await new Promise((res, rej) => {
                db.run(
                  `INSERT INTO key_levels 
                   (analysis_id, coin, level_type, description)
                   VALUES (?, ?, ?, ?)`,
                  [analysisId, coin.toUpperCase(), type, desc],
                  function(insertErr) {
                    if (insertErr) rej(insertErr);
                    else res();
                  }
                );
              });
            }
          }
        };
        
        // Save current price
        db.run(
          `INSERT INTO price_history (coin, price) VALUES (?, ?)`,
          [coin.toUpperCase(), currentPrice]
        );
        
        // Wait for async operations to complete with timeout
        promiseAllWithTimeout([savePredictions(), saveKeyLevels()], 30000)
          .then(() => {
            console.log(`[Database] Saved analysis #${analysisId} for ${coin}`);
            resolve({ analysisId, predictionIds });
          })
          .catch((saveErr) => {
            console.error('[Database] Error saving related data:', saveErr.message);
            // Still resolve with analysisId even if predictions fail
            resolve({ analysisId, predictionIds });
          });
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
    const now = new Date().toISOString();
    
    db.get(
      `SELECT close FROM ohlcv_candles 
       WHERE coin = ? AND timeframe = '15m' 
       ORDER BY ABS(strftime('%s', timestamp) - strftime('%s', ?)) ASC 
       LIMIT 1`,
      [coin.toUpperCase(), targetTimestamp],
      async (err, row) => {
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
          async (err2, row2) => {
            if (err2) {
              reject(err2);
              return;
            }
            if (row2?.price) {
              resolve(row2.price);
              return;
            }
            
            // Final fallback: use latest price from latest_prices table
            // This handles expired predictions that haven't been validated yet
            console.log(`[Database] No price_history for ${coin} at ${targetTimestamp}, using latest_prices fallback`);
            try {
              const latestPrice = await getLatestPrice(db, coin);
              if (latestPrice?.price) {
                resolve(latestPrice.price);
              } else {
                resolve(null);
              }
            } catch (latestErr) {
              console.error(`[Database] Error getting latest price for ${coin}:`, latestErr.message);
              resolve(null);
            }
          }
        );
      }
    );
  });
}

// Get recent analysis with predictions for chart overlay
export async function getRecentAnalysisWithPredictions(db, coin, limit = 50, methodId = null) {
  return new Promise((resolve, reject) => {
    const conditions = ['ah.coin = ?'];
    const values = [coin.toUpperCase()];
    
    if (methodId) {
      conditions.push('ah.method_id = ?');
      values.push(methodId);
    }
    
    // Exclude predictions with null method_id to prevent old data from showing in both methods
    conditions.push('ah.method_id IS NOT NULL');
    
    values.push(limit);
    
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
            'is_correct', p.is_correct,
            'id', p.id,
            'expires_at', p.expires_at,
            'linked_position_id', p.linked_position_id,
            'suggested_entry', p.suggested_entry,
            'suggested_stop_loss', p.suggested_stop_loss,
            'suggested_take_profit', p.suggested_take_profit,
            'expected_rr', p.expected_rr,
            'invalidation_level', p.invalidation_level,
            'reason_summary', p.reason_summary,
            'outcome', p.outcome,
            'pnl', p.pnl
          )
        ) as predictions,
        ah.breakout_retest,
        ah.position_decisions,
        ah.alternative_scenario
       FROM analysis_history ah
       LEFT JOIN predictions p ON ah.id = p.analysis_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY ah.id
       ORDER BY ah.timestamp DESC
       LIMIT ?`,
      values,
      async (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        const now = new Date().toISOString();
        const promises = [];
        
        const results = rows.map(row => {
          let predictions = JSON.parse(row.predictions || '[]').filter(p => p.timeframe);
          
          // Auto-validate expired predictions that haven't been validated yet
          predictions.forEach(pred => {
            if (pred.expires_at && pred.expires_at <= now && pred.is_correct === null) {
              // Trigger validation for this prediction
              promises.push(
                validateSinglePrediction(db, pred.id, row.coin, row.current_price, pred.direction)
                  .then(updated => {
                    if (updated) {
                      pred.actual = updated.actual_price;
                      pred.is_correct = updated.is_correct;
                    }
                  })
                  .catch(err => console.error('[Database] Auto-validate error:', err.message))
              );
            }
          });
          
          return {
            ...row,
            predictions
          };
        });
        
        // Wait for all validations to complete with timeout
        await promiseAllWithTimeout(promises, 60000); // 60s timeout for validations
        
        resolve(results);
      }
    );
  });
}

// Validate a single prediction and return updated data
async function validateSinglePrediction(db, predictionId, coin, entryPrice, direction) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    // Get actual price at expiration time (or current if already passed)
    getPriceAtTime(db, coin, now).then(actualPrice => {
      if (!actualPrice) {
        resolve(null);
        return;
      }
      
      const predictedUp = direction === 'up';
      const actualUp = actualPrice > entryPrice;
      const isCorrect = predictedUp === actualUp;
      
      db.run(
        `UPDATE predictions 
         SET actual_price = ?, is_correct = ?, accuracy = ?
         WHERE id = ?`,
        [actualPrice, isCorrect, isCorrect ? 1 : 0, predictionId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            console.log(`[Database] Auto-validated prediction #${predictionId}: ${isCorrect ? 'correct' : 'incorrect'}`);
            resolve({ actual_price: actualPrice, is_correct: isCorrect });
          }
        }
      );
    }).catch(reject);
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

// ==========================================
// PAPER TRADING - ACCOUNT FUNCTIONS
// ==========================================

// Initialize or get account for a symbol and method
export async function getOrCreateAccount(db, symbol, methodId = 'ict', startingBalance = 100) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM accounts WHERE symbol = ? AND method_id = ?`,
      [symbol.toUpperCase(), methodId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (row) {
          resolve(row);
        } else {
          // Create new account
          db.run(
            `INSERT INTO accounts (symbol, method_id, starting_balance, current_balance, equity)
             VALUES (?, ?, ?, ?, ?)`,
            [symbol.toUpperCase(), methodId, startingBalance, startingBalance, startingBalance],
            function(err) {
              if (err) {
                reject(err);
                return;
              }
              db.get(
                `SELECT * FROM accounts WHERE id = ?`,
                [this.lastID],
                (err2, newRow) => {
                  if (err2) reject(err2);
                  else resolve(newRow);
                }
              );
            }
          );
        }
      }
    );
  });
}

// Update account balance and equity
export async function updateAccount(db, accountId, updates) {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    
    if (updates.current_balance !== undefined) {
      fields.push('current_balance = ?');
      values.push(updates.current_balance);
    }
    if (updates.equity !== undefined) {
      fields.push('equity = ?');
      values.push(updates.equity);
    }
    if (updates.unrealized_pnl !== undefined) {
      fields.push('unrealized_pnl = ?');
      values.push(updates.unrealized_pnl);
    }
    if (updates.realized_pnl !== undefined) {
      fields.push('realized_pnl = ?');
      values.push(updates.realized_pnl);
    }
    if (updates.total_trades !== undefined) {
      fields.push('total_trades = ?');
      values.push(updates.total_trades);
    }
    if (updates.winning_trades !== undefined) {
      fields.push('winning_trades = ?');
      values.push(updates.winning_trades);
    }
    if (updates.losing_trades !== undefined) {
      fields.push('losing_trades = ?');
      values.push(updates.losing_trades);
    }
    if (updates.max_drawdown !== undefined) {
      fields.push('max_drawdown = ?');
      values.push(updates.max_drawdown);
    }
    if (updates.consecutive_losses !== undefined) {
      fields.push('consecutive_losses = ?');
      values.push(updates.consecutive_losses);
    }
    if (updates.last_trade_time !== undefined) {
      fields.push('last_trade_time = ?');
      values.push(updates.last_trade_time);
    }
    if (updates.cooldown_until !== undefined) {
      fields.push('cooldown_until = ?');
      values.push(updates.cooldown_until);
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(accountId);
    
    db.run(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}

// Get all accounts
export async function getAllAccounts(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM accounts ORDER BY symbol`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Get account by symbol and method
export async function getAccountBySymbolAndMethod(db, symbol, methodId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM accounts WHERE symbol = ? AND method_id = ?`,
      [symbol.toUpperCase(), methodId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Get accounts by method
export async function getAccountsByMethod(db, methodId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM accounts WHERE method_id = ? ORDER BY symbol`,
      [methodId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Get account by symbol (legacy, returns first match)
export async function getAccountBySymbol(db, symbol) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM accounts WHERE symbol = ? LIMIT 1`,
      [symbol.toUpperCase()],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Get account by ID
export async function getAccountById(db, accountId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM accounts WHERE id = ?`,
      [accountId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Reset account to starting balance by symbol and method
export async function resetAccount(db, symbol, methodId = 'ict') {
  return new Promise((resolve, reject) => {
    // Get the account first
    getAccountBySymbolAndMethod(db, symbol, methodId).then(account => {
      if (!account) {
        reject(new Error(`Account not found for ${symbol}-${methodId}`));
        return;
      }
      
      // First, close all open positions for this account
      db.run(
        `UPDATE positions SET status = 'closed_manual', close_time = datetime('now'), close_reason = 'account_reset' WHERE account_id = ? AND status = 'open'`,
        [account.id]
      );

      db.run(
        `UPDATE accounts 
         SET current_balance = starting_balance,
             equity = starting_balance,
             unrealized_pnl = 0,
             realized_pnl = 0,
             total_trades = 0,
             winning_trades = 0,
             losing_trades = 0,
             max_drawdown = 0,
             consecutive_losses = 0,
             cooldown_until = NULL,
             last_trade_time = NULL
         WHERE id = ?`,
        [account.id],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(this.changes);
        }
      );
    }).catch(reject);
  });
}

// ==========================================
// PAPER TRADING - POSITION FUNCTIONS
// ==========================================

// Create a new position
export async function createPosition(db, positionData) {
  return new Promise((resolve, reject) => {
    const {
      position_id,
      account_id,
      symbol,
      side,
      entry_price,
      current_price,
      stop_loss,
      take_profit,
      size_usd,
      size_qty,
      risk_usd,
      risk_percent,
      expected_rr,
      linked_prediction_id,
      invalidation_level,
      ict_strategy,
      tp_levels,
      tp_hit_count,
      partial_closed,
      method_id = 'ict'
    } = positionData;
    
    db.run(
      `INSERT INTO positions
       (position_id, account_id, symbol, side, entry_price, current_price, stop_loss, take_profit,
        size_usd, size_qty, risk_usd, risk_percent, expected_rr, linked_prediction_id,
        invalidation_level, ict_strategy, tp_levels, tp_hit_count, partial_closed, method_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        position_id,
        account_id,
        symbol.toUpperCase(),
        side,
        entry_price,
        current_price || entry_price, // Default to entry_price if not provided
        stop_loss,
        take_profit,
        size_usd,
        size_qty,
        risk_usd,
        risk_percent,
        expected_rr,
        linked_prediction_id,
        invalidation_level,
        ict_strategy,
        tp_levels,
        tp_hit_count || 0,
        partial_closed || 0,
        method_id
      ],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        
        // Log trade event
        logTradeEvent(db, this.lastID, 'opened', JSON.stringify(positionData)).catch(console.error);
        
        db.get(
          `SELECT * FROM positions WHERE id = ?`,
          [this.lastID],
          (err2, row) => {
            if (err2) reject(err2);
            else resolve(row);
          }
        );
      }
    );
  });
}

// Get position by ID
export async function getPosition(db, positionId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM positions WHERE id = ?`,
      [positionId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Get positions by symbol and/or status and/or method_id
export async function getPositions(db, filters = {}) {
  return new Promise((resolve, reject) => {
    const conditions = [];
    const values = [];
    
    if (filters.symbol) {
      conditions.push('symbol = ?');
      values.push(filters.symbol.toUpperCase());
    }
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        // Handle array of statuses (e.g., ['closed', 'stopped', 'taken_profit'])
        const placeholders = filters.status.map(() => '?').join(',');
        conditions.push(`status IN (${placeholders})`);
        values.push(...filters.status);
      } else {
        // Handle single status string
        conditions.push('status = ?');
        values.push(filters.status);
      }
    }
    if (filters.account_id) {
      conditions.push('account_id = ?');
      values.push(filters.account_id);
    }
    if (filters.method_id) {
      conditions.push('method_id = ?');
      values.push(filters.method_id);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    db.all(
      `SELECT * FROM positions ${whereClause} ORDER BY entry_time DESC`,
      values,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Update position
export async function updatePosition(db, positionId, updates) {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.realized_pnl !== undefined) {
      fields.push('realized_pnl = ?');
      values.push(updates.realized_pnl);
    }
    if (updates.unrealized_pnl !== undefined) {
      fields.push('unrealized_pnl = ?');
      values.push(updates.unrealized_pnl);
    }
    if (updates.current_price !== undefined) {
      fields.push('current_price = ?');
      values.push(updates.current_price);
    }
    if (updates.close_price !== undefined) {
      fields.push('close_price = ?');
      values.push(updates.close_price);
    }
    if (updates.close_time !== undefined) {
      fields.push('close_time = ?');
      values.push(updates.close_time);
    }
    if (updates.close_reason !== undefined) {
      fields.push('close_reason = ?');
      values.push(updates.close_reason);
    }
    
    if (fields.length === 0) {
      resolve(0);
      return;
    }
    
    values.push(positionId);
    
    db.run(
      `UPDATE positions SET ${fields.join(', ')} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}

// Update prediction
export async function updatePrediction(db, predictionId, updates) {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    
    if (updates.linked_position_id !== undefined) {
      fields.push('linked_position_id = ?');
      values.push(updates.linked_position_id);
    }
    if (updates.outcome !== undefined) {
      fields.push('outcome = ?');
      values.push(updates.outcome);
    }
    if (updates.pnl !== undefined) {
      fields.push('pnl = ?');
      values.push(updates.pnl);
    }
    if (updates.hit_tp !== undefined) {
      fields.push('hit_tp = ?');
      values.push(updates.hit_tp);
    }
    if (updates.hit_sl !== undefined) {
      fields.push('hit_sl = ?');
      values.push(updates.hit_sl);
    }
    if (updates.actual_price !== undefined) {
      fields.push('actual_price = ?');
      values.push(updates.actual_price);
    }
    if (updates.is_correct !== undefined) {
      fields.push('is_correct = ?');
      values.push(updates.is_correct);
    }
    
    if (fields.length === 0) {
      resolve(0);
      return;
    }
    
    values.push(predictionId);
    
    db.run(
      `UPDATE predictions SET ${fields.join(', ')} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}

// Close position
export async function closePosition(db, positionId, closePrice, closeReason) {
  return new Promise((resolve, reject) => {
    const closeTime = new Date().toISOString();
    
    db.run(
      `UPDATE positions 
       SET status = CASE 
         WHEN close_reason = 'stop_loss' THEN 'stopped'
         WHEN close_reason = 'take_profit' THEN 'taken_profit'
         WHEN close_reason = 'manual' THEN 'closed_manual'
         WHEN close_reason = 'prediction_reversal' THEN 'closed_reversal'
         ELSE 'closed'
       END,
       close_price = ?,
       close_time = ?,
       close_reason = ?
       WHERE id = ?`,
      [closePrice, closeTime, closeReason, positionId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        
        // Log trade event
        const eventType = closeReason === 'stop_loss' ? 'sl_hit' : 
                         closeReason === 'take_profit' ? 'tp_hit' : 
                         closeReason === 'prediction_reversal' ? 'reversal_close' : 'closed';
        logTradeEvent(db, positionId, eventType, 
          JSON.stringify({ close_price: closePrice, close_reason: closeReason })).catch(console.error);
        
        resolve(this.changes);
      }
    );
  });
}

// ==========================================
// PAPER TRADING - ACCOUNT SNAPSHOTS
// ==========================================

// Create account snapshot
export async function createAccountSnapshot(db, accountId, balance, equity, unrealizedPnl, openPositions) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO account_snapshots (account_id, balance, equity, unrealized_pnl, open_positions)
       VALUES (?, ?, ?, ?, ?)`,
      [accountId, balance, equity, unrealizedPnl, openPositions],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// Get account snapshots for equity curve
export async function getAccountSnapshots(db, accountId, hoursBack = 168) {
  return new Promise((resolve, reject) => {
    const since = new Date();
    since.setHours(since.getHours() - hoursBack);
    
    db.all(
      `SELECT * FROM account_snapshots 
       WHERE account_id = ? AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [accountId, since.toISOString()],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// ==========================================
// PAPER TRADING - TRADE EVENTS
// ==========================================

// Log trade event
export async function logTradeEvent(db, positionId, eventType, eventData = '{}') {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO trade_events (position_id, event_type, event_data)
       VALUES (?, ?, ?)`,
      [positionId, eventType, eventData],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// Get trade events for a position
export async function getTradeEvents(db, positionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM trade_events WHERE position_id = ? ORDER BY timestamp ASC`,
      [positionId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// ==========================================
// PAPER TRADING - PERFORMANCE CALCULATIONS
// ==========================================

// Calculate performance metrics for an account
export async function calculatePerformance(db, accountId) {
  return new Promise((resolve, reject) => {
    // Get account info
    db.get(
      `SELECT * FROM accounts WHERE id = ?`,
      [accountId],
      (err, account) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!account) {
          reject(new Error('Account not found'));
          return;
        }
        
        // Get closed positions
        db.all(
          `SELECT * FROM positions WHERE account_id = ? AND status IN ('closed', 'stopped', 'taken_profit', 'closed_manual')`,
          [accountId],
          (err2, positions) => {
            if (err2) {
              reject(err2);
              return;
            }
            
            const winningTrades = positions.filter(p => p.realized_pnl > 0);
            const losingTrades = positions.filter(p => p.realized_pnl < 0);
            
            const totalReturn = ((account.equity - account.starting_balance) / account.starting_balance) * 100;
            const winRate = positions.length > 0 ? (winningTrades.length / positions.length) * 100 : 0;
            
            const grossProfit = winningTrades.reduce((sum, p) => sum + p.realized_pnl, 0);
            const grossLoss = Math.abs(losingTrades.reduce((sum, p) => sum + p.realized_pnl, 0));
            const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
            
            const avgRisk = positions.length > 0 ? positions.reduce((sum, p) => sum + p.risk_usd, 0) / positions.length : 0;
            const avgProfit = winningTrades.length > 0 ? winningTrades.reduce((sum, p) => sum + p.realized_pnl, 0) / winningTrades.length : 0;
            const avgRMultiple = avgRisk > 0 ? avgProfit / avgRisk : 0;
            
            // Calculate max drawdown from snapshots
            db.all(
              `SELECT equity FROM account_snapshots WHERE account_id = ? ORDER BY timestamp ASC`,
              [accountId],
              (err3, snapshots) => {
                if (err3) {
                  reject(err3);
                  return;
                }
                
                let maxDrawdown = 0;
                let peak = account.starting_balance;
                
                snapshots.forEach(s => {
                  if (s.equity > peak) {
                    peak = s.equity;
                  }
                  const drawdown = ((peak - s.equity) / peak) * 100;
                  if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                  }
                });
                
                resolve({
                  starting_balance: account.starting_balance,
                  current_equity: account.equity,
                  current_balance: account.current_balance,
                  unrealized_pnl: account.unrealized_pnl,
                  realized_pnl: account.realized_pnl,
                  total_return_percent: totalReturn,
                  win_rate: winRate,
                  profit_factor: profitFactor,
                  max_drawdown: maxDrawdown > 0 ? maxDrawdown : account.max_drawdown,
                  average_r_multiple: avgRMultiple,
                  total_trades: positions.length,
                  winning_trades: winningTrades.length,
                  losing_trades: losingTrades.length,
                  consecutive_losses: account.consecutive_losses
                });
              }
            );
          }
        );
      }
    );
  });
}

/**
 * Calculate accuracy by timeframe
 */
export async function calculateAccuracyByTimeframe(db, accountId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        p.timeframe,
        COUNT(*) as total,
        SUM(CASE WHEN p.outcome = 'win' THEN 1 ELSE 0 END) as correct
      FROM predictions p
      WHERE p.coin = (SELECT symbol FROM accounts WHERE id = ?)
      AND p.predicted_at >= datetime('now', '-30 days')
      GROUP BY p.timeframe
    `;

    db.all(sql, [accountId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const result = {};
      rows.forEach(row => {
        result[row.timeframe] = {
          correct: row.correct,
          total: row.total,
          accuracy: row.total > 0 ? row.correct / row.total : 0
        };
      });

      resolve(result);
    });
  });
}

/**
 * Calculate accuracy by bias
 */
export async function calculateAccuracyByBias(db, accountId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        ah.bias,
        COUNT(*) as total,
        SUM(CASE WHEN p.outcome = 'win' THEN 1 ELSE 0 END) as correct
      FROM predictions p
      JOIN analysis_history ah ON p.analysis_id = ah.id
      WHERE p.coin = (SELECT symbol FROM accounts WHERE id = ?)
      AND p.predicted_at >= datetime('now', '-30 days')
      GROUP BY ah.bias
    `;

    db.all(sql, [accountId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const result = {};
      rows.forEach(row => {
        result[row.bias] = {
          correct: row.correct,
          total: row.total,
          accuracy: row.total > 0 ? row.correct / row.total : 0
        };
      });

      resolve(result);
    });
  });
}

/**
 * Calculate average hold time
 */
export async function calculateAverageHoldTime(db, accountId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        entry_time,
        close_time
      FROM positions
      WHERE account_id = ?
      AND status IN ('closed', 'stopped', 'taken_profit', 'closed_manual')
      AND close_time IS NOT NULL
    `;

    db.all(sql, [accountId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      if (rows.length === 0) {
        resolve({
          averageMinutes: 0,
          averageHours: 0,
          medianMinutes: 0
        });
        return;
      }

      const holdTimes = rows.map(row => {
        const entry = new Date(row.entry_time);
        const close = new Date(row.close_time);
        return (close - entry) / (1000 * 60); // minutes
      }).sort((a, b) => a - b);

      const averageMinutes = holdTimes.reduce((sum, time) => sum + time, 0) / holdTimes.length;
      const medianMinutes = holdTimes[Math.floor(holdTimes.length / 2)];

      resolve({
        averageMinutes: Math.round(averageMinutes),
        averageHours: (averageMinutes / 60).toFixed(2),
        medianMinutes: Math.round(medianMinutes)
      });
    });
  });
}

// ==========================================
// PENDING ORDERS - LIMIT ORDER FUNCTIONALITY
// ==========================================

// Create a pending order (limit order)
export async function createPendingOrder(db, orderData) {
  return new Promise((resolve, reject) => {
    const {
      order_id,
      account_id,
      symbol,
      side,
      entry_price,
      stop_loss,
      take_profit,
      size_usd,
      size_qty,
      risk_usd,
      risk_percent,
      expected_rr,
      linked_prediction_id,
      invalidation_level,
      method_id = 'ict'
    } = orderData;
    
    db.run(
      `INSERT INTO pending_orders 
       (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, 
        size_usd, size_qty, risk_usd, risk_percent, expected_rr, 
        linked_prediction_id, invalidation_level, status, created_at, executed_at, 
        executed_price, executed_size_qty, executed_size_usd, realized_pnl, realized_pnl_percent, close_reason, method_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order_id,
        account_id,
        symbol.toUpperCase(),
        side,
        entry_price,
        stop_loss,
        take_profit,
        size_usd,
        size_qty,
        risk_usd,
        risk_percent,
        expected_rr,
        linked_prediction_id,
        invalidation_level,
        'pending',
        new Date().toISOString(), // created_at
        null, // executed_at
        null, // executed_price
        null, // executed_size_qty
        null, // executed_size_usd
        null, // realized_pnl
        null, // realized_pnl_percent
        null, // close_reason
        method_id
      ],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        
        db.get(
          `SELECT * FROM pending_orders WHERE id = ?`,
          [this.lastID],
          (err2, row) => {
            if (err2) reject(err2);
            else resolve(row);
          }
        );
      }
    );
  });
}

// Get pending orders by symbol, status, and/or method_id
export async function getPendingOrders(db, filters = {}) {
  return new Promise((resolve, reject) => {
    const conditions = [];
    const values = [];
    
    if (filters.symbol) {
      conditions.push('symbol = ?');
      values.push(filters.symbol.toUpperCase());
    }
    if (filters.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }
    if (filters.account_id) {
      conditions.push('account_id = ?');
      values.push(filters.account_id);
    }
    if (filters.method_id) {
      conditions.push('method_id = ?');
      values.push(filters.method_id);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    db.all(
      `SELECT * FROM pending_orders ${whereClause} ORDER BY created_at DESC`,
      values,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Execute a pending order (convert to actual position)
export async function executePendingOrder(db, orderId, positionId) {
  return new Promise((resolve, reject) => {
    const executedAt = new Date().toISOString();
    
    db.run(
      `UPDATE pending_orders 
       SET status = 'executed', executed_at = ?
       WHERE id = ?`,
      [executedAt, orderId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}

// Cancel a pending order
export async function cancelPendingOrder(db, orderId, reason = 'cancelled') {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE pending_orders 
       SET status = ?
       WHERE id = ?`,
      [`cancelled_${reason}`, orderId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}
