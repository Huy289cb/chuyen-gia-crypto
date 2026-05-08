/**
 * SQLite to Postgres Migration Script
 * 
 * This script migrates data from the existing SQLite database to Neon Postgres.
 * It reads from backend/data/predictions.db and writes to the Postgres database.
 * 
 * Usage:
 *   npm run prisma:seed
 * 
 * Prerequisites:
 *   - SQLite database must exist at backend/data/predictions.db
 *   - Postgres database must be configured via DATABASE_URL
 *   - Prisma schema must be applied via `npm run prisma:migrate`
 * 
 * Migration Order:
 *   1. analysis_history
 *   2. predictions
 *   3. key_levels
 *   4. ohlcv_candles
 *   5. latest_prices
 *   6. price_history
 *   7. accounts
 *   8. positions
 *   9. account_snapshots
 *   10. trade_events
 *   11. pending_orders
 *   12. testnet_accounts
 *   13. testnet_positions
 *   14. testnet_trade_events
 *   15. testnet_account_snapshots
 *   16. testnet_pending_orders
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { prisma } from '../src/lib/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SQLITE_DB_PATH = join(__dirname, '..', 'data', 'predictions.db');

// Type for SQLite row
interface SqliteRow {
  [key: string]: any;
}

// Migration statistics
const stats = {
  analysis_history: 0,
  predictions: 0,
  key_levels: 0,
  ohlcv_candles: 0,
  latest_prices: 0,
  price_history: 0,
  accounts: 0,
  positions: 0,
  account_snapshots: 0,
  trade_events: 0,
  pending_orders: 0,
  testnet_accounts: 0,
  testnet_positions: 0,
  testnet_trade_events: 0,
  testnet_account_snapshots: 0,
  testnet_pending_orders: 0,
  errors: [] as string[],
};

/**
 * Open SQLite database connection
 */
function openSqliteDb(): Database.Database {
  try {
    const db = new Database(SQLITE_DB_PATH, { readonly: true });
    console.log(`[Migration] Opened SQLite database: ${SQLITE_DB_PATH}`);
    return db;
  } catch (error) {
    console.error('[Migration] Failed to open SQLite database:', error);
    throw error;
  }
}

/**
 * Migrate analysis_history table
 */
async function migrateAnalysisHistory(db: Database.Database) {
  console.log('[Migration] Migrating analysis_history...');
  
  try {
    const rows = db.prepare('SELECT * FROM analysis_history').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.analysisHistory.create({
          data: {
            coin: row.coin,
            timestamp: new Date(row.timestamp),
            current_price: row.current_price,
            bias: row.bias,
            action: row.action,
            confidence: row.confidence,
            narrative: row.narrative,
            comparison: row.comparison,
            market_sentiment: row.market_sentiment,
            disclaimer: row.disclaimer,
            method_id: row.method_id || 'ict',
            breakout_retest: row.breakout_retest,
            position_decisions: row.position_decisions,
            alternative_scenario: row.alternative_scenario,
            suggested_entry: row.suggested_entry,
            suggested_stop_loss: row.suggested_stop_loss,
            suggested_take_profit: row.suggested_take_profit,
            expected_rr: row.expected_rr,
            invalidation_level: row.invalidation_level,
            raw_question: row.raw_question,
            raw_answer: row.raw_answer,
          },
        });
        stats.analysis_history++;
      } catch (error) {
        console.error(`[Migration] Error migrating analysis_history row ${row.id}:`, error);
        stats.errors.push(`analysis_history:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.analysis_history} analysis_history records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate analysis_history:', error);
    throw error;
  }
}

/**
 * Migrate predictions table
 */
async function migratePredictions(db: Database.Database) {
  console.log('[Migration] Migrating predictions...');
  
  try {
    const rows = db.prepare('SELECT * FROM predictions').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.prediction.create({
          data: {
            analysis_id: row.analysis_id,
            coin: row.coin,
            timeframe: row.timeframe,
            direction: row.direction,
            target_price: row.target_price,
            confidence: row.confidence,
            predicted_at: new Date(row.predicted_at),
            expires_at: row.expires_at ? new Date(row.expires_at) : null,
            actual_price: row.actual_price,
            accuracy: row.accuracy,
            is_correct: row.is_correct,
            outcome: row.outcome,
            pnl: row.pnl || 0,
            hit_tp: row.hit_tp || 0,
            hit_sl: row.hit_sl || 0,
            linked_position_id: row.linked_position_id,
            suggested_entry: row.suggested_entry,
            suggested_stop_loss: row.suggested_stop_loss,
            suggested_take_profit: row.suggested_take_profit,
            expected_rr: row.expected_rr,
            invalidation_level: row.invalidation_level,
            reason_summary: row.reason_summary,
            model_version: row.model_version || '1.0',
            method_id: row.method_id || 'ict',
          },
        });
        stats.predictions++;
      } catch (error) {
        console.error(`[Migration] Error migrating prediction row ${row.id}:`, error);
        stats.errors.push(`predictions:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.predictions} predictions records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate predictions:', error);
    throw error;
  }
}

/**
 * Migrate key_levels table
 */
async function migrateKeyLevels(db: Database.Database) {
  console.log('[Migration] Migrating key_levels...');
  
  try {
    const rows = db.prepare('SELECT * FROM key_levels').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.keyLevel.create({
          data: {
            analysis_id: row.analysis_id,
            coin: row.coin,
            level_type: row.level_type,
            description: row.description,
            price_levels: row.price_levels,
          },
        });
        stats.key_levels++;
      } catch (error) {
        console.error(`[Migration] Error migrating key_level row ${row.id}:`, error);
        stats.errors.push(`key_levels:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.key_levels} key_levels records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate key_levels:', error);
    throw error;
  }
}

/**
 * Migrate ohlcv_candles table
 */
async function migrateOhlcvCandles(db: Database.Database) {
  console.log('[Migration] Migrating ohlcv_candles...');
  
  try {
    const rows = db.prepare('SELECT * FROM ohlcv_candles').all() as SqliteRow[];
    
    // Batch insert for performance
    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      for (const row of batch) {
        try {
          await prisma.ohlcvCandle.upsert({
            where: {
              coin_timestamp_timeframe: {
                coin: row.coin,
                timestamp: new Date(row.timestamp),
                timeframe: row.timeframe || '15m',
              },
            },
            update: {},
            create: {
              coin: row.coin,
              timestamp: new Date(row.timestamp),
              open: row.open,
              high: row.high,
              low: row.low,
              close: row.close,
              volume: row.volume,
              timeframe: row.timeframe || '15m',
            },
          });
          stats.ohlcv_candles++;
        } catch (error) {
          console.error(`[Migration] Error migrating ohlcv_candle row ${row.id}:`, error);
          stats.errors.push(`ohlcv_candles:${row.id}`);
        }
      }
      
      console.log(`[Migration] Processed ${Math.min(i + batchSize, rows.length)}/${rows.length} ohlcv_candles`);
    }
    
    console.log(`[Migration] Migrated ${stats.ohlcv_candles} ohlcv_candles records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate ohlcv_candles:', error);
    throw error;
  }
}

/**
 * Migrate latest_prices table
 */
async function migrateLatestPrices(db: Database.Database) {
  console.log('[Migration] Migrating latest_prices...');
  
  try {
    const rows = db.prepare('SELECT * FROM latest_prices').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.latestPrice.upsert({
          where: { coin: row.coin },
          update: {},
          create: {
            coin: row.coin,
            price: row.price,
            change_24h: row.change_24h,
            change_7d: row.change_7d,
            market_cap: row.market_cap,
            volume_24h: row.volume_24h,
            updated_at: new Date(row.updated_at),
          },
        });
        stats.latest_prices++;
      } catch (error) {
        console.error(`[Migration] Error migrating latest_price row ${row.coin}:`, error);
        stats.errors.push(`latest_prices:${row.coin}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.latest_prices} latest_prices records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate latest_prices:', error);
    throw error;
  }
}

/**
 * Migrate price_history table
 */
async function migratePriceHistory(db: Database.Database) {
  console.log('[Migration] Migrating price_history...');
  
  try {
    const rows = db.prepare('SELECT * FROM price_history').all() as SqliteRow[];
    
    // Batch insert for performance
    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      for (const row of batch) {
        try {
          await prisma.priceHistory.create({
            data: {
              coin: row.coin,
              price: row.price,
              timestamp: new Date(row.timestamp),
            },
          });
          stats.price_history++;
        } catch (error) {
          console.error(`[Migration] Error migrating price_history row ${row.id}:`, error);
          stats.errors.push(`price_history:${row.id}`);
        }
      }
      
      console.log(`[Migration] Processed ${Math.min(i + batchSize, rows.length)}/${rows.length} price_history`);
    }
    
    console.log(`[Migration] Migrated ${stats.price_history} price_history records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate price_history:', error);
    throw error;
  }
}

/**
 * Migrate accounts table
 */
async function migrateAccounts(db: Database.Database) {
  console.log('[Migration] Migrating accounts...');
  
  try {
    const rows = db.prepare('SELECT * FROM accounts').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.account.upsert({
          where: {
            symbol_method_id: {
              symbol: row.symbol,
              method_id: row.method_id || 'ict',
            },
          },
          update: {},
          create: {
            symbol: row.symbol,
            method_id: row.method_id || 'ict',
            starting_balance: row.starting_balance,
            current_balance: row.current_balance,
            equity: row.equity,
            unrealized_pnl: row.unrealized_pnl || 0,
            realized_pnl: row.realized_pnl || 0,
            total_trades: row.total_trades || 0,
            winning_trades: row.winning_trades || 0,
            losing_trades: row.losing_trades || 0,
            max_drawdown: row.max_drawdown || 0,
            consecutive_losses: row.consecutive_losses || 0,
            last_trade_time: row.last_trade_time ? new Date(row.last_trade_time) : null,
            cooldown_until: row.cooldown_until ? new Date(row.cooldown_until) : null,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
          },
        });
        stats.accounts++;
      } catch (error) {
        console.error(`[Migration] Error migrating account row ${row.id}:`, error);
        stats.errors.push(`accounts:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.accounts} accounts records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate accounts:', error);
    throw error;
  }
}

/**
 * Migrate positions table
 */
async function migratePositions(db: Database.Database) {
  console.log('[Migration] Migrating positions...');
  
  try {
    const rows = db.prepare('SELECT * FROM positions').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.position.create({
          data: {
            position_id: row.position_id,
            account_id: row.account_id,
            symbol: row.symbol,
            side: row.side,
            entry_price: row.entry_price,
            current_price: row.current_price || 0,
            stop_loss: row.stop_loss,
            take_profit: row.take_profit,
            entry_time: new Date(row.entry_time),
            status: row.status || 'open',
            size_usd: row.size_usd,
            size_qty: row.size_qty,
            risk_usd: row.risk_usd,
            risk_percent: row.risk_percent,
            expected_rr: row.expected_rr,
            realized_pnl: row.realized_pnl || 0,
            unrealized_pnl: row.unrealized_pnl || 0,
            close_price: row.close_price,
            close_time: row.close_time ? new Date(row.close_time) : null,
            close_reason: row.close_reason,
            linked_prediction_id: row.linked_prediction_id,
            invalidation_level: row.invalidation_level,
            ict_strategy: row.ict_strategy,
            tp_levels: row.tp_levels,
            tp_hit_count: row.tp_hit_count || 0,
            partial_closed: row.partial_closed || 0,
            r_multiple: row.r_multiple || 0,
            tp1_hit: row.tp1_hit || 0,
          },
        });
        stats.positions++;
      } catch (error) {
        console.error(`[Migration] Error migrating position row ${row.id}:`, error);
        stats.errors.push(`positions:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.positions} positions records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate positions:', error);
    throw error;
  }
}

/**
 * Migrate account_snapshots table
 */
async function migrateAccountSnapshots(db: Database.Database) {
  console.log('[Migration] Migrating account_snapshots...');
  
  try {
    const rows = db.prepare('SELECT * FROM account_snapshots').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.accountSnapshot.create({
          data: {
            account_id: row.account_id,
            balance: row.balance,
            equity: row.equity,
            unrealized_pnl: row.unrealized_pnl || 0,
            open_positions: row.open_positions || 0,
            timestamp: new Date(row.timestamp),
          },
        });
        stats.account_snapshots++;
      } catch (error) {
        console.error(`[Migration] Error migrating account_snapshot row ${row.id}:`, error);
        stats.errors.push(`account_snapshots:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.account_snapshots} account_snapshots records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate account_snapshots:', error);
    throw error;
  }
}

/**
 * Migrate trade_events table
 */
async function migrateTradeEvents(db: Database.Database) {
  console.log('[Migration] Migrating trade_events...');
  
  try {
    const rows = db.prepare('SELECT * FROM trade_events').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.tradeEvent.create({
          data: {
            position_id: row.position_id,
            event_type: row.event_type,
            event_data: row.event_data,
            timestamp: new Date(row.timestamp),
          },
        });
        stats.trade_events++;
      } catch (error) {
        console.error(`[Migration] Error migrating trade_event row ${row.id}:`, error);
        stats.errors.push(`trade_events:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.trade_events} trade_events records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate trade_events:', error);
    throw error;
  }
}

/**
 * Migrate pending_orders table
 */
async function migratePendingOrders(db: Database.Database) {
  console.log('[Migration] Migrating pending_orders...');
  
  try {
    const rows = db.prepare('SELECT * FROM pending_orders').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.pendingOrder.create({
          data: {
            order_id: row.order_id,
            account_id: row.account_id,
            symbol: row.symbol,
            side: row.side,
            entry_price: row.entry_price,
            stop_loss: row.stop_loss,
            take_profit: row.take_profit,
            size_usd: row.size_usd,
            size_qty: row.size_qty,
            risk_usd: row.risk_usd,
            risk_percent: row.risk_percent,
            expected_rr: row.expected_rr,
            linked_prediction_id: row.linked_prediction_id,
            invalidation_level: row.invalidation_level,
            status: row.status || 'pending',
            created_at: new Date(row.created_at),
            executed_at: row.executed_at ? new Date(row.executed_at) : null,
            executed_price: row.executed_price,
            executed_size_qty: row.executed_size_qty,
            executed_size_usd: row.executed_size_usd,
            realized_pnl: row.realized_pnl,
            realized_pnl_percent: row.realized_pnl_percent,
            close_reason: row.close_reason,
            method_id: row.method_id || 'ict',
          },
        });
        stats.pending_orders++;
      } catch (error) {
        console.error(`[Migration] Error migrating pending_order row ${row.id}:`, error);
        stats.errors.push(`pending_orders:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.pending_orders} pending_orders records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate pending_orders:', error);
    throw error;
  }
}

/**
 * Migrate testnet_accounts table
 */
async function migrateTestnetAccounts(db: Database.Database) {
  console.log('[Migration] Migrating testnet_accounts...');
  
  try {
    const rows = db.prepare('SELECT * FROM testnet_accounts').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.testnetAccount.upsert({
          where: {
            symbol_method_id: {
              symbol: row.symbol,
              method_id: row.method_id,
            },
          },
          update: {},
          create: {
            symbol: row.symbol,
            method_id: row.method_id,
            starting_balance: row.starting_balance,
            current_balance: row.current_balance,
            equity: row.equity,
            unrealized_pnl: row.unrealized_pnl || 0,
            realized_pnl: row.realized_pnl || 0,
            total_trades: row.total_trades || 0,
            winning_trades: row.winning_trades || 0,
            losing_trades: row.losing_trades || 0,
            max_drawdown: row.max_drawdown || 0,
            consecutive_losses: row.consecutive_losses || 0,
            last_trade_time: row.last_trade_time ? new Date(row.last_trade_time) : null,
            cooldown_until: row.cooldown_until ? new Date(row.cooldown_until) : null,
            precision_error_count: row.precision_error_count || 0,
            precision_cooldown_until: row.precision_cooldown_until ? new Date(row.precision_cooldown_until) : null,
            last_precision_error_time: row.last_precision_error_time ? new Date(row.last_precision_error_time) : null,
            last_precision_error_code: row.last_precision_error_code,
            last_precision_error_message: row.last_precision_error_message,
            accumulated_trading_fees: row.accumulated_trading_fees || 0,
            accumulated_funding_fee: row.accumulated_funding_fee || 0,
            api_key_hash: row.api_key_hash,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
          },
        });
        stats.testnet_accounts++;
      } catch (error) {
        console.error(`[Migration] Error migrating testnet_account row ${row.id}:`, error);
        stats.errors.push(`testnet_accounts:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.testnet_accounts} testnet_accounts records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate testnet_accounts:', error);
    throw error;
  }
}

/**
 * Migrate testnet_positions table
 */
async function migrateTestnetPositions(db: Database.Database) {
  console.log('[Migration] Migrating testnet_positions...');
  
  try {
    const rows = db.prepare('SELECT * FROM testnet_positions').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.testnetPosition.create({
          data: {
            position_id: row.position_id,
            account_id: row.account_id,
            symbol: row.symbol,
            side: row.side,
            entry_price: row.entry_price,
            current_price: row.current_price || 0,
            stop_loss: row.stop_loss,
            take_profit: row.take_profit,
            entry_time: new Date(row.entry_time),
            status: row.status || 'open',
            size_usd: row.size_usd,
            size_qty: row.size_qty,
            risk_usd: row.risk_usd,
            risk_percent: row.risk_percent,
            expected_rr: row.expected_rr,
            realized_pnl: row.realized_pnl || 0,
            unrealized_pnl: row.unrealized_pnl || 0,
            close_price: row.close_price,
            close_time: row.close_time ? new Date(row.close_time) : null,
            close_reason: row.close_reason,
            linked_prediction_id: row.linked_prediction_id,
            binance_order_id: row.binance_order_id,
            binance_sl_order_id: row.binance_sl_order_id,
            binance_tp_order_id: row.binance_tp_order_id,
            tp_levels: row.tp_levels,
            tp_hit_count: row.tp_hit_count || 0,
            partial_closed: row.partial_closed || 0,
            entry_fee: row.entry_fee || 0,
            exit_fee: row.exit_fee || 0,
            funding_fee: row.funding_fee || 0,
          },
        });
        stats.testnet_positions++;
      } catch (error) {
        console.error(`[Migration] Error migrating testnet_position row ${row.id}:`, error);
        stats.errors.push(`testnet_positions:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.testnet_positions} testnet_positions records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate testnet_positions:', error);
    throw error;
  }
}

/**
 * Migrate testnet_trade_events table
 */
async function migrateTestnetTradeEvents(db: Database.Database) {
  console.log('[Migration] Migrating testnet_trade_events...');
  
  try {
    const rows = db.prepare('SELECT * FROM testnet_trade_events').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.testnetTradeEvent.create({
          data: {
            position_id: row.position_id,
            event_type: row.event_type,
            event_data: row.event_data,
            timestamp: new Date(row.timestamp),
          },
        });
        stats.testnet_trade_events++;
      } catch (error) {
        console.error(`[Migration] Error migrating testnet_trade_event row ${row.id}:`, error);
        stats.errors.push(`testnet_trade_events:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.testnet_trade_events} testnet_trade_events records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate testnet_trade_events:', error);
    throw error;
  }
}

/**
 * Migrate testnet_account_snapshots table
 */
async function migrateTestnetAccountSnapshots(db: Database.Database) {
  console.log('[Migration] Migrating testnet_account_snapshots...');
  
  try {
    const rows = db.prepare('SELECT * FROM testnet_account_snapshots').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.testnetAccountSnapshot.create({
          data: {
            account_id: row.account_id,
            balance: row.balance,
            equity: row.equity,
            unrealized_pnl: row.unrealized_pnl || 0,
            realized_pnl: row.realized_pnl || 0,
            open_positions_count: row.open_positions_count || 0,
            timestamp: new Date(row.timestamp),
          },
        });
        stats.testnet_account_snapshots++;
      } catch (error) {
        console.error(`[Migration] Error migrating testnet_account_snapshot row ${row.id}:`, error);
        stats.errors.push(`testnet_account_snapshots:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.testnet_account_snapshots} testnet_account_snapshots records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate testnet_account_snapshots:', error);
    throw error;
  }
}

/**
 * Migrate testnet_pending_orders table
 */
async function migrateTestnetPendingOrders(db: Database.Database) {
  console.log('[Migration] Migrating testnet_pending_orders...');
  
  try {
    const rows = db.prepare('SELECT * FROM testnet_pending_orders').all() as SqliteRow[];
    
    for (const row of rows) {
      try {
        await prisma.testnetPendingOrder.create({
          data: {
            order_id: row.order_id,
            account_id: row.account_id,
            symbol: row.symbol,
            side: row.side,
            entry_price: row.entry_price,
            stop_loss: row.stop_loss,
            take_profit: row.take_profit,
            size_usd: row.size_usd,
            size_qty: row.size_qty,
            risk_usd: row.risk_usd,
            risk_percent: row.risk_percent,
            expected_rr: row.expected_rr,
            linked_prediction_id: row.linked_prediction_id,
            invalidation_level: row.invalidation_level,
            method_id: row.method_id,
            status: row.status || 'pending',
            created_at: new Date(row.created_at),
            executed_at: row.executed_at ? new Date(row.executed_at) : null,
            executed_price: row.executed_price,
            executed_size_qty: row.executed_size_qty,
            executed_size_usd: row.executed_size_usd,
            realized_pnl: row.realized_pnl,
            realized_pnl_percent: row.realized_pnl_percent,
            close_reason: row.close_reason,
            binance_order_id: row.binance_order_id,
          },
        });
        stats.testnet_pending_orders++;
      } catch (error) {
        console.error(`[Migration] Error migrating testnet_pending_order row ${row.id}:`, error);
        stats.errors.push(`testnet_pending_orders:${row.id}`);
      }
    }
    
    console.log(`[Migration] Migrated ${stats.testnet_pending_orders} testnet_pending_orders records`);
  } catch (error) {
    console.error('[Migration] Failed to migrate testnet_pending_orders:', error);
    throw error;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('=================================');
  console.log('  SQLite to Postgres Migration');
  console.log('=================================');
  
  let sqliteDb: Database.Database | null = null;
  
  try {
    // Open SQLite database
    sqliteDb = openSqliteDb();
    
    // Migrate in dependency order
    await migrateAnalysisHistory(sqliteDb);
    await migratePredictions(sqliteDb);
    await migrateKeyLevels(sqliteDb);
    await migrateOhlcvCandles(sqliteDb);
    await migrateLatestPrices(sqliteDb);
    await migratePriceHistory(sqliteDb);
    await migrateAccounts(sqliteDb);
    await migratePositions(sqliteDb);
    await migrateAccountSnapshots(sqliteDb);
    await migrateTradeEvents(sqliteDb);
    await migratePendingOrders(sqliteDb);
    await migrateTestnetAccounts(sqliteDb);
    await migrateTestnetPositions(sqliteDb);
    await migrateTestnetTradeEvents(sqliteDb);
    await migrateTestnetAccountSnapshots(sqliteDb);
    await migrateTestnetPendingOrders(sqliteDb);
    
    // Print statistics
    console.log('=================================');
    console.log('  Migration Statistics');
    console.log('=================================');
    console.log(`analysis_history: ${stats.analysis_history}`);
    console.log(`predictions: ${stats.predictions}`);
    console.log(`key_levels: ${stats.key_levels}`);
    console.log(`ohlcv_candles: ${stats.ohlcv_candles}`);
    console.log(`latest_prices: ${stats.latest_prices}`);
    console.log(`price_history: ${stats.price_history}`);
    console.log(`accounts: ${stats.accounts}`);
    console.log(`positions: ${stats.positions}`);
    console.log(`account_snapshots: ${stats.account_snapshots}`);
    console.log(`trade_events: ${stats.trade_events}`);
    console.log(`pending_orders: ${stats.pending_orders}`);
    console.log(`testnet_accounts: ${stats.testnet_accounts}`);
    console.log(`testnet_positions: ${stats.testnet_positions}`);
    console.log(`testnet_trade_events: ${stats.testnet_trade_events}`);
    console.log(`testnet_account_snapshots: ${stats.testnet_account_snapshots}`);
    console.log(`testnet_pending_orders: ${stats.testnet_pending_orders}`);
    console.log(`Errors: ${stats.errors.length}`);
    
    if (stats.errors.length > 0) {
      console.log('\nError details:');
      stats.errors.forEach((err) => console.log(`  - ${err}`));
    }
    
    console.log('=================================');
    console.log('  Migration Complete');
    console.log('=================================');
    
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    process.exit(1);
  } finally {
    if (sqliteDb) {
      sqliteDb.close();
      console.log('[Migration] SQLite database closed');
    }
    await prisma.$disconnect();
    console.log('[Migration] Prisma client disconnected');
  }
}

// Run migration
migrate();
