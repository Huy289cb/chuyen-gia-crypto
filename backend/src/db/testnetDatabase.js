/**
 * Testnet Database Functions
 * 
 * This module provides CRUD operations for Binance Futures Testnet data
 * including accounts, positions, trade events, and account snapshots
 */

/**
 * Get or create testnet account for a symbol and method
 */
export async function getOrCreateTestnetAccount(db, symbol, methodId) {
  return new Promise((resolve, reject) => {
    // Try to get existing account
    db.get(
      'SELECT * FROM testnet_accounts WHERE symbol = ? AND method_id = ?',
      [symbol, methodId],
      (err, row) => {
        if (err) {
          console.error('[TestnetDB] Error fetching testnet account:', err.message);
          reject(err);
          return;
        }
        
        if (row) {
          console.log(`[TestnetDB] Found existing testnet account: ${symbol}-${methodId}`);
          resolve(row);
          return;
        }
        
        // Create new account with 100U starting balance
        const startingBalance = 100;
        db.run(
          `INSERT INTO testnet_accounts (symbol, method_id, starting_balance, current_balance, equity)
           VALUES (?, ?, ?, ?, ?)`,
          [symbol, methodId, startingBalance, startingBalance, startingBalance],
          function(insertErr) {
            if (insertErr) {
              console.error('[TestnetDB] Error creating testnet account:', insertErr.message);
              reject(insertErr);
              return;
            }
            
            console.log(`[TestnetDB] Created new testnet account: ${symbol}-${methodId} with ${startingBalance}U`);
            
            // Fetch the newly created account
            db.get(
              'SELECT * FROM testnet_accounts WHERE id = ?',
              [this.lastID],
              (fetchErr, newRow) => {
                if (fetchErr) {
                  reject(fetchErr);
                  return;
                }
                resolve(newRow);
              }
            );
          }
        );
      }
    );
  });
}

/**
 * Get testnet account by symbol and method
 */
export async function getTestnetAccount(db, symbol, methodId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM testnet_accounts WHERE symbol = ? AND method_id = ?',
      [symbol, methodId],
      (err, row) => {
        if (err) {
          console.error('[TestnetDB] Error fetching testnet account:', err.message);
          reject(err);
          return;
        }
        resolve(row || null);
      }
    );
  });
}

/**
 * Update testnet account balance
 */
export async function updateTestnetAccountBalance(db, accountId, newBalance, pnl = 0) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.run(
      `UPDATE testnet_accounts 
       SET current_balance = ?, 
           equity = current_balance + unrealized_pnl,
           realized_pnl = realized_pnl + ?,
           updated_at = ?
       WHERE id = ?`,
      [newBalance, pnl, now, accountId],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error updating testnet account balance:', err.message);
          reject(err);
          return;
        }
        
        console.log(`[TestnetDB] Updated testnet account ${accountId}: balance=${newBalance}, pnl=${pnl}`);
        resolve(this.changes);
      }
    );
  });
}

/**
 * Update testnet account equity and unrealized PnL
 */
export async function updateTestnetAccountEquity(db, accountId, unrealizedPnl) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.run(
      `UPDATE testnet_accounts 
       SET unrealized_pnl = ?,
           equity = current_balance + ?,
           updated_at = ?
       WHERE id = ?`,
      [unrealizedPnl, unrealizedPnl, now, accountId],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error updating testnet account equity:', err.message);
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}

/**
 * Update testnet account trade statistics
 */
export async function updateTestnetAccountStats(db, accountId, isWin) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.run(
      `UPDATE testnet_accounts 
       SET total_trades = total_trades + 1,
           winning_trades = winning_trades + ?,
           losing_trades = losing_trades + ?,
           consecutive_losses = CASE WHEN ? = 0 THEN consecutive_losses + 1 ELSE 0 END,
           last_trade_time = ?,
           updated_at = ?
       WHERE id = ?`,
      [isWin ? 1 : 0, isWin ? 0 : 1, isWin ? 1 : 0, now, now, accountId],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error updating testnet account stats:', err.message);
          reject(err);
          return;
        }
        resolve(this.changes);
      }
    );
  });
}

/**
 * Create testnet position
 */
export async function createTestnetPosition(db, positionData) {
  return new Promise((resolve, reject) => {
    const {
      position_id,
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
      binance_order_id,
      binance_sl_order_id,
      binance_tp_order_id,
      tp_levels = null,
      tp_hit_count = 0,
      partial_closed = 0,
    } = positionData;
    
    db.run(
      `INSERT INTO testnet_positions (
        position_id, account_id, symbol, side, entry_price, stop_loss, take_profit,
        size_usd, size_qty, risk_usd, risk_percent, expected_rr,
        linked_prediction_id, binance_order_id, binance_sl_order_id, binance_tp_order_id,
        tp_levels, tp_hit_count, partial_closed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        position_id, account_id, symbol, side, entry_price, stop_loss, take_profit,
        size_usd, size_qty, risk_usd, risk_percent, expected_rr,
        linked_prediction_id, binance_order_id, binance_sl_order_id, binance_tp_order_id,
        tp_levels, tp_hit_count, partial_closed
      ],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error creating testnet position:', err.message);
          reject(err);
          return;
        }
        
        console.log(`[TestnetDB] Created testnet position: ${position_id} (${side} ${symbol})`);
        
        // Fetch the newly created position
        db.get(
          'SELECT * FROM testnet_positions WHERE id = ?',
          [this.lastID],
          (fetchErr, row) => {
            if (fetchErr) {
              reject(fetchErr);
              return;
            }
            resolve(row);
          }
        );
      }
    );
  });
}

/**
 * Get testnet positions with optional filters
 */
export async function getTestnetPositions(db, filters = {}) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM testnet_positions WHERE 1=1';
    const params = [];
    
    if (filters.account_id) {
      query += ' AND account_id = ?';
      params.push(filters.account_id);
    }
    
    if (filters.symbol) {
      query += ' AND symbol = ?';
      params.push(filters.symbol);
    }
    
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    
    if (filters.position_id) {
      query += ' AND position_id = ?';
      params.push(filters.position_id);
    }
    
    query += ' ORDER BY entry_time DESC';
    
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('[TestnetDB] Error fetching testnet positions:', err.message);
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

/**
 * Get single testnet position by ID
 */
export async function getTestnetPosition(db, positionId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM testnet_positions WHERE position_id = ?',
      [positionId],
      (err, row) => {
        if (err) {
          console.error('[TestnetDB] Error fetching testnet position:', err.message);
          reject(err);
          return;
        }
        resolve(row || null);
      }
    );
  });
}

/**
 * Update testnet position
 */
export async function updateTestnetPosition(db, positionId, updates) {
  return new Promise((resolve, reject) => {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    
    if (keys.length === 0) {
      resolve(0);
      return;
    }
    
    const setClause = keys.map(key => `${key} = ?`).join(', ');
    const query = `UPDATE testnet_positions SET ${setClause} WHERE position_id = ?`;
    values.push(positionId);
    
    db.run(query, values, function(err) {
      if (err) {
        console.error('[TestnetDB] Error updating testnet position:', err.message);
        reject(err);
        return;
      }
      
      console.log(`[TestnetDB] Updated testnet position ${positionId}`);
      resolve(this.changes);
    });
  });
}

/**
 * Close testnet position
 */
export async function closeTestnetPosition(db, positionId, closePrice, closeReason) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.run(
      `UPDATE testnet_positions 
       SET status = 'closed',
           close_price = ?,
           close_time = ?,
           close_reason = ?
       WHERE position_id = ?`,
      [closePrice, now, closeReason, positionId],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error closing testnet position:', err.message);
          reject(err);
          return;
        }
        
        console.log(`[TestnetDB] Closed testnet position ${positionId} at ${closePrice} (${closeReason})`);
        resolve(this.changes);
      }
    );
  });
}

/**
 * Record testnet trade event
 */
export async function recordTestnetTradeEvent(db, positionId, eventType, eventData = null) {
  return new Promise((resolve, reject) => {
    const eventDataStr = eventData ? JSON.stringify(eventData) : null;
    
    db.run(
      'INSERT INTO testnet_trade_events (position_id, event_type, event_data) VALUES (?, ?, ?)',
      [positionId, eventType, eventDataStr],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error recording testnet trade event:', err.message);
          reject(err);
          return;
        }
        
        console.log(`[TestnetDB] Recorded testnet trade event: ${eventType} for ${positionId}`);
        resolve(this.lastID);
      }
    );
  });
}

/**
 * Create testnet account snapshot
 */
export async function createTestnetAccountSnapshot(db, accountId) {
  return new Promise((resolve, reject) => {
    // First get current account data
    db.get(
      'SELECT * FROM testnet_accounts WHERE id = ?',
      [accountId],
      (err, account) => {
        if (err) {
          console.error('[TestnetDB] Error fetching account for snapshot:', err.message);
          reject(err);
          return;
        }
        
        if (!account) {
          reject(new Error('Account not found'));
          return;
        }
        
        // Get open positions count
        db.get(
          'SELECT COUNT(*) as count FROM testnet_positions WHERE account_id = ? AND status = ?',
          [accountId, 'open'],
          (countErr, countResult) => {
            if (countErr) {
              console.error('[TestnetDB] Error counting open positions:', countErr.message);
              reject(countErr);
              return;
            }
            
            const openPositionsCount = countResult.count;
            
            // Create snapshot
            db.run(
              `INSERT INTO testnet_account_snapshots 
               (account_id, balance, equity, unrealized_pnl, realized_pnl, open_positions_count)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                accountId,
                account.current_balance,
                account.equity,
                account.unrealized_pnl,
                account.realized_pnl,
                openPositionsCount
              ],
              function(snapshotErr) {
                if (snapshotErr) {
                  console.error('[TestnetDB] Error creating testnet account snapshot:', snapshotErr.message);
                  reject(snapshotErr);
                  return;
                }
                
                console.log(`[TestnetDB] Created testnet account snapshot for account ${accountId}`);
                resolve(this.lastID);
              }
            );
          }
        );
      }
    );
  });
}

/**
 * Get testnet account snapshots
 */
export async function getTestnetAccountSnapshots(db, accountId, limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM testnet_account_snapshots WHERE account_id = ? ORDER BY timestamp DESC LIMIT ?',
      [accountId, limit],
      (err, rows) => {
        if (err) {
          console.error('[TestnetDB] Error fetching testnet account snapshots:', err.message);
          reject(err);
          return;
        }
        resolve(rows || []);
      }
    );
  });
}

/**
 * Get testnet performance metrics
 */
export async function getTestnetPerformanceMetrics(db, accountId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM testnet_accounts WHERE id = ?',
      [accountId],
      (err, account) => {
        if (err) {
          console.error('[TestnetDB] Error fetching testnet account for metrics:', err.message);
          reject(err);
          return;
        }
        
        if (!account) {
          resolve(null);
          return;
        }
        
        // Calculate additional metrics
        const winRate = account.total_trades > 0 
          ? (account.winning_trades / account.total_trades) * 100 
          : 0;
        
        const avgWin = account.winning_trades > 0 
          ? account.realized_pnl / account.winning_trades 
          : 0;
        
        const profitFactor = account.losing_trades > 0 && account.realized_pnl > 0
          ? Math.abs(avgWin / (account.realized_pnl / account.losing_trades))
          : account.realized_pnl > 0 ? Infinity : 0;
        
        const totalReturn = ((account.current_balance - account.starting_balance) / account.starting_balance) * 100;
        
        resolve({
          ...account,
          win_rate: winRate,
          avg_win: avgWin,
          profit_factor: profitFactor,
          total_return: totalReturn,
        });
      }
    );
  });
}

/**
 * Get testnet trade events for a position
 */
export async function getTestnetTradeEvents(db, positionId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM testnet_trade_events WHERE position_id = ? ORDER BY timestamp ASC',
      [positionId],
      (err, rows) => {
        if (err) {
          console.error('[TestnetDB] Error fetching testnet trade events:', err.message);
          reject(err);
          return;
        }
        
        // Parse event_data JSON
        const events = (rows || []).map(event => ({
          ...event,
          event_data: event.event_data ? JSON.parse(event.event_data) : null,
        }));
        
        resolve(events);
      }
    );
  });
}

/**
 * Reset testnet account
 */
export async function resetTestnetAccount(db, accountId) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.run(
      `UPDATE testnet_accounts 
       SET current_balance = starting_balance,
           equity = starting_balance,
           unrealized_pnl = 0,
           realized_pnl = 0,
           total_trades = 0,
           winning_trades = 0,
           losing_trades = 0,
           max_drawdown = 0,
           consecutive_losses = 0,
           last_trade_time = NULL,
           cooldown_until = NULL,
           updated_at = ?
       WHERE id = ?`,
      [now, accountId],
      function(err) {
        if (err) {
          console.error('[TestnetDB] Error resetting testnet account:', err.message);
          reject(err);
          return;
        }
        
        console.log(`[TestnetDB] Reset testnet account ${accountId}`);
        resolve(this.changes);
      }
    );
  });
}
