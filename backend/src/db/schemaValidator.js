/**
 * Database Schema Validator
 * Validates that INSERT statements match actual table schemas to prevent column mismatch errors
 */

/**
 * Get table schema from database
 */
export async function getTableSchema(db, tableName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
      if (err) {
        reject(err);
      } else {
        // Exclude id column (auto-increment)
        const columnNames = columns
          .filter(col => col.name !== 'id')
          .map(col => col.name);
        resolve(columnNames);
      }
    });
  });
}

/**
 * Validate INSERT statement column count matches table schema
 */
export async function validateInsertSchema(db, tableName, insertColumns) {
  try {
    const tableColumns = await getTableSchema(db, tableName);
    
    console.log(`[SchemaValidator] Table: ${tableName}`);
    console.log(`[SchemaValidator] Schema columns (${tableColumns.length}):`, tableColumns);
    console.log(`[SchemaValidator] INSERT columns (${insertColumns.length}):`, insertColumns);
    
    // Check for missing columns (in schema but not in INSERT)
    const missingColumns = tableColumns.filter(col => !insertColumns.includes(col));
    if (missingColumns.length > 0) {
      console.error(`[SchemaValidator] ERROR: Missing columns in INSERT: ${missingColumns.join(', ')}`);
      return {
        valid: false,
        error: `Missing columns in INSERT: ${missingColumns.join(', ')}`,
        missingColumns
      };
    }
    
    // Check for extra columns (in INSERT but not in schema)
    const extraColumns = insertColumns.filter(col => !tableColumns.includes(col));
    if (extraColumns.length > 0) {
      console.error(`[SchemaValidator] ERROR: Extra columns in INSERT: ${extraColumns.join(', ')}`);
      return {
        valid: false,
        error: `Extra columns in INSERT: ${extraColumns.join(', ')}`,
        extraColumns
      };
    }
    
    console.log(`[SchemaValidator] ✓ Schema validation passed for ${tableName}`);
    return { valid: true };
  } catch (err) {
    console.error(`[SchemaValidator] ERROR validating ${tableName}:`, err.message);
    return {
      valid: false,
      error: err.message
    };
  }
}

/**
 * Validate all critical table schemas
 */
export async function validateAllSchemas(db) {
  const validations = [
    {
      table: 'positions',
      columns: [
        'position_id', 'account_id', 'symbol', 'side', 'entry_price', 'current_price',
        'stop_loss', 'take_profit', 'entry_time', 'status', 'size_usd', 'size_qty',
        'risk_usd', 'risk_percent', 'expected_rr', 'realized_pnl', 'unrealized_pnl',
        'close_price', 'close_time', 'close_reason', 'linked_prediction_id',
        'invalidation_level', 'tp1_hit', 'ict_strategy', 'tp_levels', 'tp_hit_count',
        'partial_closed', 'method_id', 'r_multiple'
      ]
    },
    {
      table: 'pending_orders',
      columns: [
        'order_id', 'account_id', 'symbol', 'side', 'entry_price', 'stop_loss',
        'take_profit', 'size_usd', 'size_qty', 'risk_usd', 'risk_percent',
        'expected_rr', 'linked_prediction_id', 'invalidation_level', 'status',
        'created_at', 'executed_at', 'executed_price', 'executed_size_qty',
        'executed_size_usd', 'realized_pnl', 'realized_pnl_percent', 'close_reason', 'method_id'
      ]
    },
    {
      table: 'accounts',
      columns: [
        'symbol', 'method_id', 'starting_balance', 'current_balance', 'equity',
        'unrealized_pnl', 'realized_pnl', 'total_trades', 'winning_trades',
        'losing_trades', 'max_drawdown', 'consecutive_losses', 'last_trade_time',
        'cooldown_until', 'created_at', 'updated_at'
      ]
    }
  ];
  
  let allValid = true;
  const errors = [];
  
  for (const validation of validations) {
    const result = await validateInsertSchema(db, validation.table, validation.columns);
    if (!result.valid) {
      allValid = false;
      errors.push({
        table: validation.table,
        error: result.error
      });
    }
  }
  
  if (!allValid) {
    console.error('[SchemaValidator] Schema validation FAILED:');
    errors.forEach(err => {
      console.error(`  - ${err.table}: ${err.error}`);
    });
    throw new Error('Schema validation failed. See logs for details.');
  }
  
  console.log('[SchemaValidator] ✓ All schema validations passed');
  return { valid: true };
}

/**
 * Run schema validation on startup (optional)
 */
export async function runSchemaValidationOnStartup(db) {
  try {
    console.log('[SchemaValidator] Running schema validation on startup...');
    await validateAllSchemas(db);
    console.log('[SchemaValidator] Schema validation completed successfully');
  } catch (err) {
    console.error('[SchemaValidator] Schema validation failed:', err.message);
    // Don't throw - allow system to start but log the error
    console.warn('[SchemaValidator] System starting despite schema validation errors. Manual intervention may be required.');
  }
}
