# Data Migration Guide: SQLite to PostgreSQL

## Overview

This guide documents the complete data migration process from SQLite to PostgreSQL as part of Phase 2.4 of the Go Migration project. The migration involves 16 database tables with approximately 1.2MB of data.

## Migration Architecture

```
SQLite Database → CSV Export → Data Transformation → PostgreSQL Import
     (predictions.db)      (export/)          (transformed/)          (crypto_trading)
```

### Migration Steps

1. **Pre-Migration Validation** - Validate SQLite data integrity
2. **Data Export** - Export all tables to CSV format
3. **Data Transformation** - Transform timestamps, JSON, and NULL values
4. **Data Import** - Import transformed data to PostgreSQL
5. **Post-Migration Validation** - Validate PostgreSQL data integrity

## Prerequisites

### Software Requirements

- Node.js 18+ (for migration scripts)
- PostgreSQL 18+
- SQLite3 (Node.js package)

### Environment Variables

Set the following environment variables before running migration:

```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=your_password
export POSTGRES_DATABASE=crypto_trading
```

### Database Setup

Ensure PostgreSQL database is created and schema is applied:

```bash
# Create database
createdb crypto_trading

# Apply Ent schema migrations
cd backend-go
go run entgo.io/ent/cmd/ent generate ./internal/db/ent/schema
```

## Migration Scripts

All migration scripts are located in `backend-go/scripts/migrate/`:

- `pre-migration-validation.js` - Validates SQLite data before export
- `export-data.js` - Exports SQLite tables to CSV files
- `transform-data.js` - Transforms CSV data for PostgreSQL
- `import-data.js` - Imports transformed CSV to PostgreSQL
- `post-migration-validation.js` - Validates PostgreSQL data after import
- `migrate.js` - Master orchestration script

## Running the Migration

### Full Migration (Recommended)

Run the complete migration with all validations:

```bash
cd backend-go/scripts/migrate
node migrate.js
```

This will:
1. Validate SQLite data
2. Export all tables to CSV
3. Transform data (timestamps, JSON, NULL handling)
4. Import to PostgreSQL
5. Validate PostgreSQL data

### Step-by-Step Migration

Run each step individually for more control:

```bash
# Step 1: Pre-migration validation
node pre-migration-validation.js

# Step 2: Export data
node export-data.js

# Step 3: Transform data
node transform-data.js

# Step 4: Import data
node import-data.js

# Step 5: Post-migration validation
node post-migration-validation.js
```

### Export-Only Mode

Export data without importing (useful for testing):

```bash
node migrate.js --export-only
```

### Import-Only Mode

Import previously exported data:

```bash
node migrate.js --import-only
```

### Skip Validation

Skip pre/post validation (not recommended for production):

```bash
node migrate.js --skip-validation
```

## Data Transformation Details

### Timestamp Conversion

SQLite stores timestamps in various formats:
- ISO 8601 strings
- SQLite datetime format
- Unix timestamps

All timestamps are converted to ISO 8601 format with timezone (e.g., `2024-01-15T10:30:00.000Z`).

### JSON Field Validation

JSON fields are validated and reformatted:
- `analysis_history.breakout_retest`
- `analysis_history.position_decisions`
- `analysis_history.alternative_scenario`
- `key_levels.price_levels`
- `positions.tp_levels`
- `testnet_positions.tp_levels`
- `trade_events.event_data`
- `testnet_trade_events.event_data`

Invalid JSON is set to NULL with a warning.

### NULL Value Handling

Empty strings are converted to NULL for appropriate columns:
- Numeric fields (REAL, INTEGER)
- Timestamp fields
- JSON fields

### Method ID Transformation

Method IDs are normalized to lowercase:
- `ICT` → `ict`
- `KIM_NGHIA` → `kim_nghia`

## Tables Migrated

### Core Tables (6)

1. **analysis_history** - Analysis run records
2. **predictions** - Timeframe predictions
3. **key_levels** - ICT key levels
4. **ohlcv_candles** - OHLCV candle data
5. **latest_prices** - Latest price cache
6. **price_history** - Historical price records

### Paper Trading Tables (5)

7. **accounts** - Paper trading accounts
8. **positions** - Open/closed positions
9. **pending_orders** - Limit orders
10. **account_snapshots** - Account equity snapshots
11. **trade_events** - Position event logs

### Testnet Tables (5)

12. **testnet_accounts** - Testnet accounts
13. **testnet_positions** - Testnet positions
14. **testnet_pending_orders** - Testnet limit orders
15. **testnet_account_snapshots** - Testnet snapshots
16. **testnet_trade_events** - Testnet event logs

## Foreign Key Dependencies

Import order respects foreign key constraints:

```
analysis_history → predictions → key_levels
                 ↓
                 positions → trade_events
                 ↓
                 pending_orders
                 ↓
                 account_snapshots

testnet_accounts → testnet_positions → testnet_trade_events
                  ↓
                  testnet_pending_orders
                  ↓
                  testnet_account_snapshots
```

## Validation Checks

### Pre-Migration Validation

- Database file existence
- Table existence
- NULL values in required fields
- JSON field validity
- Duplicate records
- Timestamp format validity
- Foreign key relationships
- Data quality (negative balances, unrealistic prices)

### Post-Migration Validation

- Record count comparison (SQLite vs PostgreSQL)
- Foreign key relationships
- Index creation
- Data types and precision
- Calculated fields (equity, PnL)
- Sample data checksums

## Zero-Downtime Strategy

### Option 1: Blue-Green Deployment

1. **Setup Phase**
   - Deploy Go backend with PostgreSQL to staging
   - Run full migration on staging database
   - Validate with parity tests

2. **Switch Phase**
   - Stop Node.js backend
   - Start Go backend on production
   - Monitor for 24 hours
   - Keep Node.js as rollback option

3. **Cleanup Phase**
   - After 7 days of stable operation
   - Decommission Node.js backend
   - Archive SQLite database

### Option 2: Shadow Mode

1. **Dual-Write Phase**
   - Configure Node.js to write to both SQLite and PostgreSQL
   - Run Go backend in read-only mode for validation
   - Compare data consistency

2. **Switch Phase**
   - Switch Go backend to write mode
   - Stop Node.js dual-write
   - Monitor for 24 hours

3. **Cleanup Phase**
   - After 7 days of stable operation
   - Decommission Node.js backend

### Option 3: Gradual Traffic Switch

1. **Setup Phase**
   - Deploy Go backend alongside Node.js
   - Configure load balancer with 90% Node.js, 10% Go
   - Monitor error rates and response times

2. **Gradual Shift**
   - Week 1: 90% Node.js, 10% Go
   - Week 2: 75% Node.js, 25% Go
   - Week 3: 50% Node.js, 50% Go
   - Week 4: 25% Node.js, 75% Go
   - Week 5: 0% Node.js, 100% Go

3. **Cleanup Phase**
   - After Week 5, decommission Node.js

### Recommended Strategy

**Blue-Green Deployment** is recommended for this migration because:
- Simple to implement
- Clear rollback path
- Minimal risk
- Easy to validate

## Rollback Plan

### Immediate Rollback (< 1 hour)

If critical issues are detected:

1. Stop Go backend
2. Start Node.js backend with SQLite
3. Investigate and fix issues
4. Re-run migration when fixed

### Full Rollback (< 24 hours)

If issues cannot be quickly resolved:

1. Stop Go backend
2. Start Node.js backend with SQLite
3. Drop PostgreSQL database (optional)
4. Continue with Node.js until Go version is fixed

### Rollback Script

```bash
# Stop Go backend
pm2 stop crypto-trading-go

# Start Node.js backend
pm2 start backend/src/index.js --name crypto-trading-nodejs

# Verify Node.js is working
curl http://localhost:3000/api/health
```

## Backup Strategy

### Pre-Migration Backup

The pre-migration validation script automatically creates a backup:

```
backend/data/backup_<timestamp>.db
```

### Manual Backup

Before migration, manually backup:

```bash
# Backup SQLite database
cp backend/data/predictions.db backend/data/predictions.db.backup

# Backup PostgreSQL (if already in use)
pg_dump crypto_trading > crypto_trading_backup.sql
```

### Backup Retention

Keep backups for at least 30 days after successful migration.

## Troubleshooting

### Common Issues

#### Issue: "Database file not found"

**Solution**: Verify SQLite database path in `pre-migration-validation.js`

#### Issue: "Connection refused" to PostgreSQL

**Solution**: 
- Check PostgreSQL is running
- Verify host and port in environment variables
- Check firewall settings

#### Issue: "Relation does not exist"

**Solution**: 
- Ensure Ent schema is applied to PostgreSQL
- Run `go run entgo.io/ent/cmd/ent generate ./internal/db/ent/schema`

#### Issue: "Record count mismatch"

**Solution**:
- Check for failed imports in import script output
- Re-run import for affected table
- Check for duplicate records in source

#### Issue: "Invalid JSON"

**Solution**:
- Check transformation script output for warnings
- Manually fix invalid JSON in source SQLite database
- Re-run export and transformation

### Getting Help

If you encounter issues not covered here:

1. Check the script output for detailed error messages
2. Review the validation reports
3. Check PostgreSQL logs: `tail -f /var/log/postgresql/postgresql-18-main.log`
4. Check SQLite database integrity: `sqlite3 predictions.db "PRAGMA integrity_check;"`

## Performance Considerations

### Expected Migration Time

- Small database (< 10MB): ~5-10 minutes
- Medium database (10-100MB): ~10-30 minutes
- Large database (> 100MB): ~30-60 minutes

### Optimization Tips

1. **Batch Size**: The import script processes records one at a time. For large databases, consider batching.
2. **Indexes**: Drop indexes before import, recreate after import for faster imports.
3. **Connection Pooling**: Configure PostgreSQL connection pool for optimal performance.
4. **Parallel Import**: Import independent tables in parallel (e.g., ohlcv_candles and price_history).

## Post-Migration Checklist

- [ ] All validation checks pass
- [ ] Record counts match between SQLite and PostgreSQL
- [ ] Foreign key relationships are valid
- [ ] Indexes are created
- [ ] Go backend connects to PostgreSQL successfully
- [ ] API endpoints return correct data
- [ ] Paper trading system works correctly
- [ ] Testnet integration works correctly
- [ ] Multi-method analysis produces same results
- [ ] AI position management works correctly
- [ ] BTC-only mode is maintained
- [ ] Performance metrics are acceptable
- [ ] No errors in application logs
- [ ] Rollback plan is tested
- [ ] Backup is verified

## References

- Phase 2 Task Breakdown: `docs/plans/phase2-task-breakdown.md`
- Database Schema: `backend/src/db/database.js`
- Migrations: `backend/src/db/migrations.js`
- Ent Schema: `backend-go/internal/db/ent/schema/`
