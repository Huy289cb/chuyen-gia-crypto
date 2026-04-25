# Phase 2: Backend Migration to Go + Ent + PostgreSQL

Comprehensive migration plan to transition the entire backend system from Node.js/Express/SQLite to Go/Ent ORM/PostgreSQL while maintaining all existing functionality including multi-method analysis, paper trading, and Binance testnet integration.

## 1. Phân Tích Sự Khác Biệt (Differences Analysis)

### 1.1 Mô Hình Xử Lý Bất Đồng Bộ (Async Processing Models)

**Node.js Event Loop (Current Implementation):**

**Current Scheduler Architecture:**
- **Main Scheduler** (`scheduler.js`): Uses `node-cron` with multiple scheduled jobs
  - KimNghia analysis: `0,15,30,45 * * * *` (every 15 minutes)
  - Prediction validation: `0 * * * *` (hourly)
  - Data retention: `0 3 * * *` (daily at 3 AM)
  - ICT method: Currently disabled (code preserved for future multi-method support)
- **Price Update Scheduler** (`priceUpdateScheduler.js`): Runs every 1 minute
  - Updates position PnL with 1-minute candle data
  - Checks SL/TP using candle high/low for accurate detection
  - Executes pending orders when price hits entry level
  - Creates account snapshots every 5 minutes
- **Non-blocking I/O**: All database operations use Promises with async/await
- **Memory Guard**: `promiseAllWithTimeout` prevents RAM overload (30s timeout for batch operations)
- **Error Handling**: Try-catch blocks with graceful degradation (system continues if individual operations fail)

**Key Async Patterns in Current Code:**
```javascript
// Sequential async operations with timeout protection
await promiseAllWithTimeout([savePredictions(), saveKeyLevels()], 30000)

// Rate limiting for external APIs
if (timeSinceLastCall < MIN_CALL_INTERVAL) {
  await new Promise(resolve => setTimeout(resolve, waitTime));
}

// Dynamic imports for lazy loading
const { initDatabase } = await import('./db/database.js');
```

**Go Goroutines (Target Implementation):**

**Concurrency Model:**
- **Multi-threaded with lightweight goroutines** (~2KB stack vs Node.js ~1-2MB per thread)
- **Channels for communication**: Safe data sharing between goroutines
- **True parallelism**: Utilizes all CPU cores (Node.js is single-threaded)
- **Built-in primitives**: `sync.WaitGroup`, `sync.Mutex`, `context.Context`
- **No event loop blocking**: CPU-bound tasks don't block I/O operations

**Migration Implications:**

**1. Scheduler Migration:**
```go
// Replace node-cron with robfig/cron
c := cron.New(cron.WithSeconds())
c.AddFunc("0,15,30,45 * * * *", func() {
    runMethodAnalysis("kim_nghia")
})
c.AddFunc("* * * * *", func() {
    runPriceUpdateJob()
})
c.Start()
```

**2. Async/Await to Goroutine Conversion:**
```javascript
// Node.js: Sequential async operations
const analysis = await analyzer.analyze(priceData, db);
await saveAnalysis(db, coin, priceData, analysis);
```
```go
// Go: Parallel operations with goroutines
var wg sync.WaitGroup
analysisCh := make(chan *Analysis, 1)
saveCh := make(chan error, 1)

wg.Add(2)
go func() {
    defer wg.Done()
    analysis := analyzer.Analyze(priceData, db)
    analysisCh <- analysis
}()
go func() {
    defer wg.Done()
    saveCh <- saveAnalysis(db, coin, priceData, <-analysisCh)
}()
wg.Wait()
```

**3. Worker Pool for Concurrent Price Updates:**
```go
// Worker pool for updating multiple positions concurrently
type PriceUpdateWorker struct {
    jobs chan Position
    results chan error
}

func (w *PriceUpdateWorker) Start(numWorkers int) {
    for i := 0; i < numWorkers; i++ {
        go w.process()
    }
}

func (w *PriceUpdateWorker) process() {
    for pos := range w.jobs {
        w.results <- updatePositionPnL(pos)
    }
}
```

**4. Graceful Shutdown with Context:**
```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// Shutdown signal handling
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

<-sigChan
cancel() // Cancel all running goroutines
```

**5. Parallel Multi-Timeframe Analysis:**
```go
// Analyze 15m, 1h, 4h, 1d timeframes in parallel
timeframes := []string{"15m", "1h", "4h", "1d"}
results := make(chan TimeframeAnalysis, len(timeframes))

for _, tf := range timeframes {
    go func(timeframe string) {
        results <- analyzeTimeframe(priceData, timeframe)
    }(tf)
}

// Collect results
var analyses []TimeframeAnalysis
for i := 0; i < len(timeframes); i++ {
    analyses = append(analyses, <-results)
}
```

**Performance Benefits:**
- **CPU-bound tasks**: Go can utilize multiple cores (e.g., parallel candle data processing)
- **I/O-bound tasks**: Go's goroutines are more efficient than Node.js event loop for high concurrency
- **Memory efficiency**: Goroutines use ~2KB stack vs Node.js ~1-2MB per async operation
- **No callback hell**: Go's channel-based communication is more readable than nested Promises

### 1.2 Quản Lý Dữ Liệu (Data Management)

**SQLite (Current Implementation):**

**Database Schema Overview:**
- **File-based database**: `backend/data/predictions.db` (no server process)
- **WAL mode**: Enabled for concurrent reads/writes (required for 1-minute price updates)
- **Manual SQL queries**: Using `sqlite3` driver with callback-based API
- **Schema validation**: `schemaValidator.js` checks column matches on startup
- **Migration system**: `migrations.js` handles incremental schema changes
- **Single-node deployment**: Limited to one server instance

**Current Tables (15 total):**

**Core Analysis Tables:**
1. **analysis_history** - Stores each analysis run
   - Columns: id, coin, timestamp, current_price, bias, action, confidence, narrative, comparison, market_sentiment, disclaimer, method_id, breakout_retest (TEXT/JSON), position_decisions (TEXT/JSON), alternative_scenario (TEXT/JSON), suggested_entry, suggested_stop_loss, suggested_take_profit, expected_rr, invalidation_level, raw_question, raw_answer
   - Indexes: idx_analysis_history_method

2. **predictions** - Individual timeframe predictions
   - Columns: id, analysis_id, coin, timeframe, direction, target_price, confidence, predicted_at, expires_at, actual_price, accuracy, is_correct, outcome, pnl, hit_tp, hit_sl, linked_position_id, suggested_entry, suggested_stop_loss, suggested_take_profit, expected_rr, invalidation_level, reason_summary, model_version, method_id
   - Indexes: idx_predictions_analysis, idx_predictions_coin_time, idx_predictions_method

3. **key_levels** - ICT key levels for each analysis
   - Columns: id, analysis_id, coin, level_type, description, price_levels (TEXT/JSON)
   - Foreign Key: analysis_id → analysis_history(id)

**Price Data Tables:**
4. **ohlcv_candles** - 15-minute candles (primary data source)
   - Columns: id, coin, timestamp, open, high, low, close, volume, timeframe
   - Unique constraint: (coin, timestamp, timeframe)
   - Indexes: idx_ohlcv_coin_time, idx_ohlcv_timeframe
   - Data retention: 30 days for 15m candles

5. **latest_prices** - Most recent price for quick access
   - Columns: coin (PRIMARY KEY), price, change_24h, change_7d, market_cap, volume_24h, updated_at

6. **price_history** - Legacy table for validation (kept for compatibility)
   - Columns: id, coin, price, timestamp
   - Indexes: idx_price_history_coin_time

**Paper Trading Tables:**
7. **accounts** - Trading accounts per symbol/method
   - Columns: id, symbol, method_id, starting_balance, current_balance, equity, unrealized_pnl, realized_pnl, total_trades, winning_trades, losing_trades, max_drawdown, consecutive_losses, last_trade_time, cooldown_until, created_at, updated_at
   - Unique constraint: (symbol, method_id)
   - Indexes: idx_accounts_method

8. **positions** - Open/closed trading positions
   - Columns: id, position_id (UNIQUE), account_id, symbol, side, entry_price, current_price, stop_loss, take_profit, entry_time, status, size_usd, size_qty, risk_usd, risk_percent, expected_rr, realized_pnl, unrealized_pnl, close_price, close_time, close_reason, linked_prediction_id, invalidation_level, tp1_hit, ict_strategy (TEXT/JSON), tp_levels (TEXT/JSON), tp_hit_count, partial_closed, method_id, r_multiple
   - Foreign Keys: account_id → accounts(id), linked_prediction_id → predictions(id)
   - Indexes: idx_positions_account, idx_positions_symbol, idx_positions_status, idx_positions_method

9. **pending_orders** - Limit orders waiting execution
   - Columns: id, order_id (UNIQUE), account_id, symbol, side, entry_price, stop_loss, take_profit, size_usd, size_qty, risk_usd, risk_percent, expected_rr, linked_prediction_id, invalidation_level, status, created_at, executed_at, executed_price, executed_size_qty, executed_size_usd, realized_pnl, realized_pnl_percent, close_reason, method_id, binance_order_id
   - Foreign Key: linked_prediction_id → predictions(id)
   - Indexes: idx_pending_orders_account, idx_pending_orders_symbol, idx_pending_orders_status, idx_pending_orders_method

10. **account_snapshots** - Historical account equity snapshots
    - Columns: id, account_id, balance, equity, unrealized_pnl, open_positions, timestamp
    - Foreign Key: account_id → accounts(id)
    - Indexes: idx_snapshots_account_time

11. **trade_events** - Position lifecycle events
    - Columns: id, position_id, event_type, event_data (TEXT/JSON), timestamp
    - Foreign Key: position_id → positions(id)
    - Indexes: idx_events_position

**Testnet Tables (Binance Futures Testnet):**
12. **testnet_accounts** - Testnet trading accounts
    - Columns: id, symbol, method_id, starting_balance, current_balance, equity, unrealized_pnl, realized_pnl, total_trades, winning_trades, losing_trades, max_drawdown, consecutive_losses, last_trade_time, cooldown_until, api_key_hash, created_at, updated_at
    - Unique constraint: (symbol, method_id)
    - Indexes: idx_testnet_accounts_method

13. **testnet_positions** - Testnet positions with Binance order IDs
    - Columns: id, position_id (UNIQUE), account_id, symbol, side, entry_price, current_price, stop_loss, take_profit, entry_time, status, size_usd, size_qty, risk_usd, risk_percent, expected_rr, realized_pnl, unrealized_pnl, close_price, close_time, close_reason, linked_prediction_id, binance_order_id, binance_sl_order_id, binance_tp_order_id
    - Foreign Key: account_id → testnet_accounts(id)
    - Indexes: idx_testnet_positions_account, idx_testnet_positions_symbol, idx_testnet_positions_status

14. **testnet_trade_events** - Testnet position events
    - Columns: id, position_id, event_type, event_data (TEXT/JSON), timestamp
    - Indexes: idx_testnet_events_position

15. **testnet_account_snapshots** - Testnet account snapshots
    - Columns: id, account_id, balance, equity, unrealized_pnl, realized_pnl, open_positions_count, timestamp
    - Foreign Key: account_id → testnet_accounts(id)
    - Indexes: idx_testnet_snapshots_account_time

16. **testnet_pending_orders** - Testnet limit orders
    - Columns: id, order_id (UNIQUE), account_id, symbol, side, entry_price, stop_loss, take_profit, size_usd, size_qty, risk_usd, risk_percent, expected_rr, linked_prediction_id, invalidation_level, method_id, status, created_at, executed_at, executed_price, executed_size_qty, executed_size_usd, realized_pnl, realized_pnl_percent, close_reason, binance_order_id
    - Foreign Key: account_id → testnet_accounts(id)

**Key Data Types Used:**
- **INTEGER**: Auto-increment IDs, counts (id, total_trades, winning_trades, etc.)
- **REAL**: Financial data (prices, balances, PnL, percentages)
- **TEXT**: Strings, JSON stored as TEXT (breakout_retest, position_decisions, tp_levels)
- **DATETIME**: Timestamps (stored as ISO 8601 strings)
- **BOOLEAN**: Stored as INTEGER (0/1) in SQLite

**Current Query Patterns:**
```javascript
// INSERT with dynamic columns
db.run(`INSERT INTO analysis_history (coin, current_price, bias, ...) VALUES (?, ?, ?, ...)`, [...])

// SELECT with JOINs
db.all(`SELECT p.*, ah.current_price FROM predictions p JOIN analysis_history ah ON p.analysis_id = ah.id WHERE ...`)

// UPDATE with conditions
db.run(`UPDATE positions SET current_price = ?, unrealized_pnl = ? WHERE id = ?`, [...])

// Schema validation on startup
db.all(`PRAGMA table_info(${tableName})`, (err, columns) => { ... })
```

**PostgreSQL (Target Implementation):**

**Database Schema Overview:**
- **Client-server architecture**: PostgreSQL 15+ with connection pooling (pgBouncer)
- **ACID compliance**: Full transaction support with advanced features
- **Ent ORM**: Type-safe schema definition and queries with code generation
- **Built-in migrations**: Automatic schema diffing and version control
- **Replication support**: Built-in streaming replication for high availability
- **Better performance**: Optimized for complex queries and concurrent writes

**Ent ORM Schema Mapping:**

**Type Mapping:**
| SQLite Type | PostgreSQL Type | Ent Field Type | Example |
|-------------|-----------------|----------------|---------|
| INTEGER | BIGINT | field.Int64() | id, total_trades |
| REAL | DECIMAL(20,8) | field.Float64() | price, balance, pnl |
| TEXT | TEXT | field.String() | symbol, narrative |
| DATETIME | TIMESTAMPTZ | field.Time() | timestamp, entry_time |
| JSON (TEXT) | JSONB | field.JSON() | breakout_retest, position_decisions |
| BOOLEAN (INTEGER) | BOOLEAN | field.Bool() | is_correct |

**Ent Schema Example (analysis_history):**
```go
// ent/schema/analysis_history.go
package schema

import (
    "entgo.io/ent"
    "entgo.io/ent/schema/edge"
    "entgo.io/ent/schema/field"
    "entgo.io/ent/schema/index"
)

type AnalysisHistory struct {
    ent.Schema
}

func (AnalysisHistory) Fields() []ent.Field {
    return []ent.Field{
        field.String("coin").NotEmpty(),
        field.Time("timestamp").Default(time.Now),
        field.Float("current_price"),
        field.String("bias").NotEmpty(),
        field.String("action").NotEmpty(),
        field.Float("confidence"),
        field.Text("narrative").Optional(),
        field.Text("comparison").Optional(),
        field.Text("market_sentiment").Optional(),
        field.Text("disclaimer").Optional(),
        field.String("method_id").Default("ict"),
        field.JSON("breakout_retest", map[string]interface{}{}).Optional(),
        field.JSON("position_decisions", []map[string]interface{}{}).Optional(),
        field.JSON("alternative_scenario", map[string]interface{}{}).Optional(),
        field.Float("suggested_entry").Optional(),
        field.Float("suggested_stop_loss").Optional(),
        field.Float("suggested_take_profit").Optional(),
        field.Float("expected_rr").Optional(),
        field.Float("invalidation_level").Optional(),
        field.Text("raw_question").Optional(),
        field.Text("raw_answer").Optional(),
    }
}

func (AnalysisHistory) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("predictions", Prediction.Type),
    }
}

func (AnalysisHistory) Indexes() []ent.Index {
    return []ent.Index{
        index.Fields("method_id"),
    }
}
```

**Ent Query Examples:**
```go
// Insert
client.AnalysisHistory.Create().
    SetCoin("BTC").
    SetCurrentPrice(50000.0).
    SetBias("bullish").
    SetAction("buy").
    SetConfidence(0.85).
    SetMethodID("kim_nghia").
    Save(ctx)

// Select with pagination
analyses, err := client.AnalysisHistory.Query().
    Where(analysishistory.Coin("BTC")).
    Where(analysishistory.MethodID("kim_nghia")).
    Order(ent.Desc(analysishistory.FieldTimestamp)).
    Limit(50).
    Offset(0).
    All(ctx)

// Update
_, err := client.Position.Update().
    SetCurrentPrice(51000.0).
    SetUnrealizedPnL(100.0).
    Where(position.ID(positionID)).
    Save(ctx)

// Complex query with relations
analysis, err := client.AnalysisHistory.Query().
    Where(analysishistory.ID(analysisID)).
    WithPredictions(func(q *ent.PredictionQuery) {
        q.Where(prediction.Timeframe("4h"))
    }).
    Only(ctx)
```

**Ent ORM Benefits:**
- **Schema-as-code**: Define schema as Go structs, generate code automatically
- **Type-safe queries**: Compile-time validation prevents runtime errors
- **Automatic migrations**: `ent migrate` generates and applies schema changes
- **Built-in hooks**: Intercept create/update/delete operations for validation
- **Graph traversal**: Navigate relationships easily (analysis.Predictions)
- **Code generation**: Reduces boilerplate, generates CRUD operations
- **JSONB support**: Native JSON storage with query capabilities
- **Context support**: Built-in request context for timeout/cancellation

## 2. Lộ Trình Thực Hiện (Roadmap)

### Phase 2.1: Chuẩn Bị (Preparation) - 1-2 Weeks

**2.1.1 Environment Setup:**
- Install Go 1.21+ and PostgreSQL 15+
- Set up development environment with air (hot reload)
- Configure PostgreSQL with pgBouncer for connection pooling
- Set up Docker Compose for local development
- Configure environment variables (GROQ_API_KEY, BINANCE_API_KEY, etc.)

**2.1.2 Go Project Initialization:**
```bash
go mod init github.com/chuyen-gia-crypto/backend
go get entgo.io/ent/cmd/ent
go get github.com/lib/pq
go get github.com/robfig/cron/v3
go get github.com/adshao/go-binance/v2
```

**2.1.3 Documentation:**
- Document all API endpoints and their responses
- Document database schema with relationships
- Document scheduler intervals and job logic
- Document error handling patterns

### Phase 2.2: Thiết Kế Schema (Schema Design) - 1 Week

**2.2.1 Ent Schema Definition:**
- Convert all SQLite tables to Ent schemas
- Define relationships (edges) between entities
- Add indexes for performance optimization
- Implement JSONB fields for flexible data (breakout_retest, position_decisions)

**2.2.2 Schema Migration Strategy:**
- Use Ent's automatic migration system
- Version-controlled migrations with Atlas
- Rollback capability for each migration
- Data validation during migration

**2.2.3 Key Schema Considerations:**
- Use `timestamptz` for all timestamp fields (UTC)
- Use `decimal` for financial data (price, balance)
- Use `jsonb` for flexible JSON fields
- Add composite indexes for common query patterns
- Implement foreign key constraints

### Phase 2.3: Porting Logic (Logic Porting) - 3-4 Weeks

**2.3.1 Core Components (Week 1):**
- Database layer (Ent client initialization)
- Configuration management (viper or env)
- Logging (zap or logrus)
- Error handling patterns

**2.3.2 Price Fetching (Week 1-2):**
- Port price-fetcher.js to Go
- Implement Binance API client (go-binance/v2)
- Add CoinGecko fallback
- Implement caching layer

**2.3.3 Groq AI Integration (Week 2):**
- Port groq-client.js to Go
- Implement JSON parsing with error handling
- Add retry logic with exponential backoff
- Implement prompt building for multi-method analysis

**2.3.4 Scheduler System (Week 2-3):**
- Replace node-cron with robfig/cron
- Implement multi-method staggered scheduler
- Port price update scheduler (1-minute intervals)
- Add graceful shutdown with context cancellation

**2.3.5 Paper Trading Engine (Week 3):**
- Port paperTradingEngine.js to Go
- Implement position management logic
- Add SL/TP detection with candle data
- Implement account equity calculation
- Add cooldown system

**2.3.6 Testnet Integration (Week 3-4):**
- Port testnetEngine.js to Go
- Implement Binance Futures Testnet client
- Add order management (market, limit, stop-loss)
- Implement position synchronization
- Add webhook support for order updates

**2.3.7 API Layer (Week 4):**
- Replace Express with Gin or Chi framework
- Implement all REST endpoints
- Add middleware (CORS, logging, rate limiting)
- Implement WebSocket for real-time updates

### Phase 2.4: Migrating Data (Data Migration) - 1 Week

**2.4.1 Data Export:**
- Export SQLite data to CSV/JSON
- Validate data integrity
- Create backup of original database

**2.4.2 Data Import:**
- Transform data to match Ent schema
- Import to PostgreSQL using COPY or pg_restore
- Validate imported data
- Run consistency checks

**2.4.3 Verification:**
- Compare record counts between SQLite and PostgreSQL
- Validate relationships (foreign keys)
- Check data types and precision
- Verify indexes are created

### Phase 2.5: Testing (Testing) - 2 Weeks

**2.5.1 Unit Testing:**
- Write unit tests for all business logic
- Use testify for assertions
- Mock external dependencies (Groq, Binance)
- Achieve >80% code coverage

**2.5.2 Integration Testing:**
- Test database operations with testcontainers
- Test API endpoints with httptest
- Test scheduler logic with time mocking
- Test error scenarios

**2.5.3 Parity Testing:**
- Run Node.js and Go versions in parallel
- Compare analysis results
- Compare paper trading outcomes
- Compare API responses
- Validate performance improvements

**2.5.4 Load Testing:**
- Test concurrent price updates
- Test database connection pooling
- Test memory usage under load
- Verify goroutine leak prevention

### Phase 2.6: Deployment (Deployment) - 1 Week

**2.6.1 Build Process:**
- Create Dockerfile for Go application
- Set up multi-stage build for smaller image
- Configure health checks
- Implement graceful shutdown

**2.6.2 Monitoring:**
- Add Prometheus metrics
- Implement structured logging
- Set up alerting for critical errors
- Monitor database connections

**2.6.3 Rollback Plan:**
- Keep Node.js version as fallback
- Document rollback procedure
- Test rollback process
- Set up feature flags

## 3. Chiến Lược Migration Dữ Liệu (Data Migration Strategy)

### 3.1 Pre-Migration Checklist

**3.1.1 Data Validation:**
- Check for NULL values in required fields
- Validate foreign key relationships
- Check for duplicate records
- Verify timestamp formats
- Validate JSON fields are parseable

**3.1.2 Schema Mapping:**

| SQLite Type | PostgreSQL Type | Ent Field Type |
|-------------|-----------------|----------------|
| INTEGER | BIGINT | field.Int64() |
| REAL | DECIMAL(20,8) | field.Float64() |
| TEXT | TEXT | field.String() |
| DATETIME | TIMESTAMPTZ | field.Time() |
| BLOB | BYTEA | field.Bytes() |
| JSON (stored as TEXT) | JSONB | field.JSON() |

### 3.2 Migration Steps

**Step 1: Export SQLite Data**
```bash
# Export each table to CSV
sqlite3 predictions.db <<EOF
.headers on
.mode csv
.output analysis_history.csv
SELECT * FROM analysis_history;
.output predictions.csv
SELECT * FROM predictions;
.output key_levels.csv
SELECT * FROM key_levels;
-- Repeat for all tables
.quit
EOF
```

**Step 2: Transform Data**
- Convert timestamps to ISO 8601 format with timezone
- Parse JSON fields and validate structure
- Handle NULL values appropriately
- Transform method_id to enum if needed

**Step 3: Import to PostgreSQL**
```bash
# Use psql COPY for fast import
psql -U postgres -d crypto_analyzer -c "\COPY analysis_history FROM 'analysis_history.csv' CSV HEADER"
psql -U postgres -d crypto_analyzer -c "\COPY predictions FROM 'predictions.csv' CSV HEADER"
-- Repeat for all tables
```

**Step 4: Post-Migration Validation**
```sql
-- Compare record counts
SELECT 'analysis_history' as table_name, COUNT(*) as count FROM analysis_history
UNION ALL
SELECT 'predictions', COUNT(*) FROM predictions;

-- Check foreign key constraints
SELECT COUNT(*) FROM predictions WHERE analysis_id NOT IN (SELECT id FROM analysis_history);

-- Validate data types
SELECT COUNT(*) FROM analysis_history WHERE current_price IS NULL;
```

### 3.3 Integrity Preservation

**3.3.1 Transactional Migration:**
- Wrap each table import in a transaction
- Rollback on any error
- Log all errors for manual review

**3.3.2 Referential Integrity:**
- Import parent tables first (analysis_history, accounts)
- Import child tables next (predictions, positions)
- Validate foreign keys after each import
- Fix orphaned records before proceeding

**3.3.3 Data Consistency:**
- Run checksums on exported and imported data
- Compare sample records manually
- Validate calculated fields (equity, PnL)
- Re-run calculations to verify accuracy

### 3.4 Zero-Downtime Strategy

**Option 1: Blue-Green Deployment**
- Run Node.js and Go versions simultaneously
- Use PostgreSQL as single source of truth
- Gradually switch traffic to Go version
- Keep Node.js as rollback option

**Option 2: Shadow Mode**
- Run Go version in parallel without serving traffic
- Compare results with Node.js version
- Fix discrepancies before switching
- Switch traffic once parity achieved

## 4. Cấu Trúc Thư Mục Go (Go Project Structure)

```
backend-go/
├── cmd/
│   └── server/
│       └── main.go                 # Application entry point
├── internal/
│   ├── config/
│   │   ├── config.go               # Configuration loading
│   │   └── methods.go              # Method configurations
│   ├── db/
│   │   ├── ent/
│   │   │   ├── schema/             # Ent schema definitions
│   │   │   │   ├── analysis_history.go
│   │   │   │   ├── predictions.go
│   │   │   │   ├── accounts.go
│   │   │   │   ├── positions.go
│   │   │   │   └── ...
│   │   │   ├── client.go           # Ent client initialization
│   │   │   └── migrate.go          # Migration runner
│   │   ├── repository/             # Data access layer
│   │   │   ├── analysis_repo.go
│   │   │   ├── account_repo.go
│   │   │   ├── position_repo.go
│   │   │   └── prediction_repo.go
│   │   └── postgres.go             # PostgreSQL connection
│   ├── services/
│   │   ├── analyzer/
│   │   │   ├── ict_analyzer.go
│   │   │   ├── kim_nghia_analyzer.go
│   │   │   └── factory.go
│   │   ├── trading/
│   │   │   ├── paper_trading.go
│   │   │   ├── testnet_trading.go
│   │   │   └── auto_entry.go
│   │   ├── binance/
│   │   │   ├── client.go
│   │   │   ├── market.go
│   │   │   ├── trading.go
│   │   │   └── stream.go
│   │   └── ai/
│   │       └── groq_client.go
│   ├── schedulers/
│   │   ├── analysis_scheduler.go
│   │   ├── price_scheduler.go
│   │   └── validation_scheduler.go
│   ├── handlers/
│   │   ├── analysis_handler.go
│   │   ├── position_handler.go
│   │   ├── account_handler.go
│   │   └── testnet_handler.go
│   ├── middleware/
│   │   ├── cors.go
│   │   ├── logging.go
│   │   └── auth.go
│   └── models/
│       ├── analysis.go
│       ├── position.go
│       └── order.go
├── pkg/
│   ├── utils/
│   │   ├── date.go
│   │   ├── fibonacci.go
│   │   └── validator.go
│   └── cache/
│       └── redis.go                # Redis cache (optional)
├── api/
│   └── openapi.yaml                 # API documentation
├── scripts/
│   ├── migrate.sh                   # Data migration script
│   └── seed.sh                      # Seed data script
├── deployments/
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml
│   └── kubernetes/
│       └── deployment.yaml
├── test/
│   ├── unit/
│   │   ├── analyzer_test.go
│   │   └── trading_test.go
│   ├── integration/
│   │   ├── api_test.go
│   │   └── db_test.go
│   └── testdata/
│       └── fixtures.json
├── go.mod
├── go.sum
├── Makefile
├── .air.toml                       # Hot reload config
├── .env.example
└── README.md
```

### 4.1 Key Design Principles

**4.1.1 Clean Architecture:**
- `cmd/`: Application entry points
- `internal/`: Private application code
- `pkg/`: Public libraries that can be reused
- Separation of concerns (handlers, services, repositories)

**4.1.2 Dependency Injection:**
- Use interfaces for service dependencies
- Constructor injection for testability
- Wire or Fx for dependency injection (optional)

**4.1.3 Error Handling:**
- Custom error types with error wrapping
- Structured error responses
- Error logging with context

## 5. Rủi Ro và Cách Phòng Tránh (Risks and Mitigation)

### 5.1 Common Migration Risks

**5.1.1 Data Loss**
- **Risk:** Data corruption during migration
- **Mitigation:**
  - Create full backup before migration
  - Use transactional imports
  - Validate data after each step
  - Keep SQLite database as fallback

**5.1.2 Schema Mismatch**
- **Risk:** Ent schema doesn't match SQLite schema
- **Mitigation:**
  - Document all SQLite tables and columns
  - Use Atlas for schema diffing
  - Test migration on copy of production data
  - Implement schema validation on startup

**5.1.3 Performance Regression**
- **Risk:** Go version slower than Node.js
- **Mitigation:**
  - Benchmark critical paths
  - Use pprof for profiling
  - Optimize database queries with indexes
  - Implement connection pooling

**5.1.4 Goroutine Leaks**
- **Risk:** Unbounded goroutine creation
- **Mitigation:**
  - Use worker pools for concurrent tasks
  - Implement context cancellation
  - Monitor goroutine count in production
  - Set timeouts for all operations

**5.1.5 Memory Issues**
- **Risk:** Higher memory usage than Node.js
- **Mitigation:**
  - Profile memory usage with pprof
  - Implement streaming for large datasets
  - Use limit/offset for pagination
  - Set GOMEMLIMIT environment variable

**5.1.6 Database Connection Exhaustion**
- **Risk:** Too many connections to PostgreSQL
- **Mitigation:**
  - Use pgBouncer for connection pooling
  - Set max open connections in Ent
  - Implement connection reuse
  - Monitor connection metrics

**5.1.7 Timezone Handling**
- **Risk:** Timestamps incorrectly converted
- **Mitigation:**
  - Use timestamptz for all timestamps
  - Store all times in UTC
  - Convert to local time only for display
  - Add timezone tests

**5.1.8 JSON Parsing Errors**
- **Risk:** Groq JSON responses fail to parse
- **Mitigation:**
  - Implement robust JSON parser with fallback
  - Add validation for all JSON fields
  - Log raw responses on parse errors
  - Implement retry logic for malformed responses

**5.1.9 Scheduler Drift**
- **Risk:** Cron jobs drift or stop running
- **Mitigation:**
  - Use robfig/cron with seconds precision
  - Implement health checks for schedulers
  - Log scheduler execution times
  - Add monitoring for missed jobs

**5.1.10 API Incompatibility**
- **Risk:** Frontend breaks due to API changes
- **Mitigation:**
  - Keep API contract identical
  - Use OpenAPI spec for validation
  - Implement API versioning if needed
  - Test frontend against Go backend

### 5.2 Testing Strategy

**5.2.1 Parity Testing:**
- Run both systems in parallel for 1 week
- Compare all analysis results
- Compare all trading decisions
- Compare all API responses
- Document and fix all discrepancies

**5.2.2 Load Testing:**
- Simulate 1000 concurrent requests
- Test with 1-minute price updates
- Test with multiple analysis methods
- Monitor memory and CPU usage
- Verify no goroutine leaks

**5.2.3 Chaos Testing:**
- Test database connection failures
- Test external API failures (Groq, Binance)
- Test network partitions
- Test OOM scenarios
- Verify graceful degradation

### 5.3 Rollback Plan

**5.3.1 Immediate Rollback:**
- Switch traffic back to Node.js version
- Restore PostgreSQL from backup if needed
- Investigate root cause
- Fix issue before retry

**5.3.2 Data Rollback:**
- Keep SQLite database as source of truth
- Sync PostgreSQL from SQLite if needed
- Implement dual-write during transition
- Gradual migration of read traffic

**5.3.3 Feature Flags:**
- Implement feature flags for new features
- Enable features incrementally
- Monitor metrics after each enablement
- Quick disable if issues detected

## 6. Success Criteria

**6.1 Functional Requirements:**
- All existing features work identically
- API responses match Node.js version
- Paper trading produces same results
- Testnet integration works correctly
- Multi-method analysis produces same outputs

**6.2 Performance Requirements:**
- API response time < 100ms (p95)
- Memory usage < 512MB
- CPU usage < 50% under normal load
- Database queries < 10ms (p95)
- Support 1000 concurrent connections

**6.3 Reliability Requirements:**
- 99.9% uptime
- Zero data loss during migration
- Graceful handling of external API failures
- Automatic recovery from crashes
- No goroutine leaks

**6.4 Maintainability Requirements:**
- Code coverage > 80%
- All code documented
- Clear error messages
- Structured logging
- Easy to add new analysis methods

## 7. Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| 2.1 Preparation | 1-2 weeks | Environment setup, Go project initialized |
| 2.2 Schema Design | 1 week | Ent schemas defined, migrations ready |
| 2.3 Logic Porting | 3-4 weeks | All components ported to Go |
| 2.4 Data Migration | 1 week | All data migrated to PostgreSQL |
| 2.5 Testing | 2 weeks | Unit, integration, parity tests passed |
| 2.6 Deployment | 1 week | Production deployment, monitoring set up |
| **Total** | **8-10 weeks** | **Fully migrated Go backend** |

## 8. Next Steps

1. Review and approve this plan
2. Set up Go development environment
3. Begin Phase 2.1: Preparation
4. Create detailed task breakdown for each phase
5. Set up weekly progress reviews
