# Data Migration Scripts

This directory contains scripts for migrating data from SQLite to PostgreSQL as part of Phase 2.4 of the Go Migration project.

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=your_password
export POSTGRES_DATABASE=crypto_trading

# Run full migration
npm run migrate
```

## Scripts

### Master Script

- **migrate.js** - Orchestrates the complete migration process
  - Runs all validation, export, transform, and import steps
  - Options: `--skip-validation`, `--export-only`, `--import-only`

### Individual Scripts

- **pre-migration-validation.js** - Validates SQLite data before export
- **export-data.js** - Exports SQLite tables to CSV files
- **transform-data.js** - Transforms CSV data for PostgreSQL
- **import-data.js** - Imports transformed CSV to PostgreSQL
- **post-migration-validation.js** - Validates PostgreSQL data after import

## NPM Scripts

```bash
npm run migrate          # Run full migration
npm run validate-pre     # Run pre-migration validation only
npm run export           # Export data only
npm run transform        # Transform data only
npm run import           # Import data only
npm run validate-post    # Run post-migration validation only
```

## Directory Structure

```
scripts/migrate/
├── package.json                      # Dependencies and scripts
├── README.md                         # This file
├── migrate.js                        # Master orchestration script
├── pre-migration-validation.js       # Pre-migration validation
├── export-data.js                    # Data export
├── transform-data.js                 # Data transformation
├── import-data.js                    # Data import
├── post-migration-validation.js      # Post-migration validation
├── export/                           # Exported CSV files (generated)
└── transformed/                      # Transformed CSV files (generated)
```

## Migration Process

1. **Pre-Migration Validation**
   - Validates SQLite data integrity
   - Checks for NULL values in required fields
   - Validates JSON fields
   - Checks foreign key relationships
   - Creates backup of SQLite database

2. **Data Export**
   - Exports all 16 tables to CSV format
   - Handles special characters and escaping
   - Preserves data types

3. **Data Transformation**
   - Converts timestamps to ISO 8601 format
   - Validates and reformats JSON fields
   - Handles NULL values appropriately
   - Normalizes method_id values

4. **Data Import**
   - Imports transformed CSV to PostgreSQL
   - Respects foreign key constraints
   - Handles data type conversions
   - Imports in dependency order

5. **Post-Migration Validation**
   - Compares record counts
   - Validates foreign key relationships
   - Checks index creation
   - Validates calculated fields

## Tables Migrated

### Core Tables (6)
- analysis_history
- predictions
- key_levels
- ohlcv_candles
- latest_prices
- price_history

### Paper Trading Tables (5)
- accounts
- positions
- pending_orders
- account_snapshots
- trade_events

### Testnet Tables (5)
- testnet_accounts
- testnet_positions
- testnet_pending_orders
- testnet_account_snapshots
- testnet_trade_events

## Environment Variables

Required for import and post-migration validation:

```bash
POSTGRES_HOST=localhost          # PostgreSQL host
POSTGRES_PORT=5432              # PostgreSQL port
POSTGRES_USER=postgres          # PostgreSQL user
POSTGRES_PASSWORD=your_password # PostgreSQL password
POSTGRES_DATABASE=crypto_trading # PostgreSQL database name
```

## Troubleshooting

### Issue: "Module not found"

**Solution**: Install dependencies:
```bash
npm install
```

### Issue: "Database file not found"

**Solution**: Verify SQLite database path in `pre-migration-validation.js`. Default: `../../../backend/data/predictions.db`

### Issue: "Connection refused" to PostgreSQL

**Solution**: 
- Check PostgreSQL is running
- Verify host and port in environment variables
- Check firewall settings

### Issue: "Relation does not exist"

**Solution**: Ensure Ent schema is applied to PostgreSQL before running import.

## Documentation

For detailed migration instructions, zero-downtime strategies, and troubleshooting, see:

**[Data Migration Guide](../../docs/plans/data-migration-guide.md)**

## Support

For issues or questions:
1. Check the main documentation
2. Review script output for detailed error messages
3. Check PostgreSQL logs
4. Verify SQLite database integrity
