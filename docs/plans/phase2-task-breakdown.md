# Phase 2: Go Migration - Detailed Task Breakdown

## Phase 2.1: Preparation (Week 1-2)

### 2.1.1 Environment Setup
- [ ] Install Go 1.21+ from https://go.dev/dl/
- [ ] Verify Go installation with `go version`
- [ ] Set GOPATH and GOROOT environment variables
- [ ] Install PostgreSQL 18+ for Windows
- [ ] Verify PostgreSQL installation with `psql --version`
- [ ] Install pgAdmin or DBeaver for database management
- [ ] Install air for hot reload: `go install github.com/cosmtrek/air@latest`
- [ ] Verify air installation
- [ ] Install Docker Desktop (already installed: v28.3.0)
- [ ] Create Docker Compose file for PostgreSQL development
- [ ] Test PostgreSQL container startup
- [ ] Configure environment variables (.env file)
- [ ] Copy existing .env from Node.js backend as reference

### 2.1.2 Go Project Initialization
- [ ] Create `backend-go/` directory
- [ ] Initialize Go module: `go mod init github.com/chuyen-gia-crypto/backend`
- [ ] Install Ent ORM: `go get entgo.io/ent/cmd/ent`
- [ ] Install PostgreSQL driver: `go get github.com/lib/pq`
- [ ] Install cron scheduler: `go get github.com/robfig/cron/v3`
- [ ] Install Binance client: `go get github.com/adshao/go-binance/v2`
- [ ] Install Gin framework: `go get github.com/gin-gonic/gin`
- [ ] Install Viper for config: `go get github.com/spf13/viper`
- [ ] Install Zap logger: `go get go.uber.org/zap`
- [ ] Install testify for testing: `go get github.com/stretchr/testify`
- [ ] Create project structure following clean architecture
- [ ] Initialize Ent schema: `go run entgo.io/ent/cmd/ent init --target internal/db/ent`
- [ ] Create .air.toml for hot reload configuration
- [ ] Create Makefile with common commands
- [ ] Create README.md for Go backend

### 2.1.3 Documentation
- [ ] Document all existing API endpoints (GET/POST/PUT/DELETE)
- [ ] Document API request/response formats
- [ ] Document database schema with all 16 tables
- [ ] Document foreign key relationships
- [ ] Document indexes and constraints
- [ ] Document scheduler intervals (Kim Nghia: 15m, Price Update: 10s, etc.)
- [ ] Document scheduler job logic and dependencies
- [ ] Document error handling patterns
- [ ] Document timezone handling (UTC storage, Vietnam time display)
- [ ] Document AI position management capabilities (BTC-only mode)
- [ ] Document confidence thresholds (ICT: 70%, Kim Nghia: 75%)
- [ ] Document trading rules (risk management, RR ratios, etc.)

### 2.1.4 Weekly Review Setup
- [ ] Schedule weekly review meeting (same day/time each week)
- [ ] Create progress tracking template
- [ ] Set up milestone checkpoints
- [ ] Define success criteria for each phase

---

## Phase 2.2: Schema Design (Week 3)

### 2.2.1 Ent Schema Definition
- [ ] Create `analysis_history.go` schema
- [ ] Create `predictions.go` schema
- [ ] Create `key_levels.go` schema
- [ ] Create `ohlcv_candles.go` schema
- [ ] Create `latest_prices.go` schema
- [ ] Create `price_history.go` schema
- [ ] Create `accounts.go` schema
- [ ] Create `positions.go` schema
- [ ] Create `pending_orders.go` schema
- [ ] Create `account_snapshots.go` schema
- [ ] Create `trade_events.go` schema
- [ ] Create `testnet_accounts.go` schema
- [ ] Create `testnet_positions.go` schema
- [ ] Create `testnet_trade_events.go` schema
- [ ] Create `testnet_account_snapshots.go` schema
- [ ] Create `testnet_pending_orders.go` schema

### 2.2.2 Schema Relationships
- [ ] Define edges for analysis_history → predictions
- [ ] Define edges for analysis_history → key_levels
- [ ] Define edges for accounts → positions
- [ ] Define edges for accounts → pending_orders
- [ ] Define edges for accounts → account_snapshots
- [ ] Define edges for positions → trade_events
- [ ] Define edges for predictions → positions (linked_prediction_id)
- [ ] Define edges for predictions → pending_orders (linked_prediction_id)
- [ ] Define edges for testnet_accounts → testnet_positions
- [ ] Define edges for testnet_accounts → testnet_pending_orders
- [ ] Define edges for testnet_accounts → testnet_account_snapshots
- [ ] Define edges for testnet_positions → testnet_trade_events

### 2.2.3 Schema Indexes
- [ ] Add index on analysis_history.method_id
- [ ] Add index on predictions.analysis_id
- [ ] Add index on predictions (coin, timeframe)
- [ ] Add index on predictions.method_id
- [ ] Add index on ohlcv_candles (coin, timestamp, timeframe)
- [ ] Add index on ohlcv_candles.timeframe
- [ ] Add index on accounts (symbol, method_id)
- [ ] Add index on accounts.method_id
- [ ] Add index on positions.account_id
- [ ] Add index on positions.symbol
- [ ] Add index on positions.status
- [ ] Add index on positions.method_id
- [ ] Add index on pending_orders.account_id
- [ ] Add index on pending_orders.symbol
- [ ] Add index on pending_orders.status
- [ ] Add index on pending_orders.method_id
- [ ] Add index on account_snapshots (account_id, timestamp)
- [ ] Add index on trade_events.position_id
- [ ] Add similar indexes for testnet tables

### 2.2.4 Schema Data Types
- [ ] Use field.Int64() for INTEGER columns
- [ ] Use field.Float64() for REAL/DECIMAL columns
- [ ] Use field.String() for TEXT columns
- [ ] Use field.Time() for DATETIME columns (timestamptz)
- [ ] Use field.JSON() for JSON columns (JSONB)
- [ ] Use field.Bool() for BOOLEAN columns
- [ ] Add validators for required fields
- [ ] Add default values where applicable

### 2.2.5 Schema Migration Strategy
- [ ] Install Atlas for schema diffing: `go install entgo.io/ent/cmd/cmd@latest`
- [ ] Configure Atlas for PostgreSQL
- [ ] Generate initial migration: `atlas migrate diff init`
- [ ] Test migration on local PostgreSQL
- [ ] Implement rollback capability
- [ ] Document migration versioning
- [ ] Create migration script template

### 2.2.6 Schema Validation
- [ ] Add schema validation on startup
- [ ] Validate all tables exist
- [ ] Validate all columns match expected types
- [ ] Validate all indexes are created
- [ ] Validate all foreign keys are enforced
- [ ] Add schema hash for change detection

---

## Phase 2.3: Logic Porting (Week 4-7)

### 2.3.1 Core Components (Week 4)
- [ ] Create config package with Viper
- [ ] Load environment variables
- [ ] Create logger package with Zap
- [ ] Implement structured logging
- [ ] Create error handling package
- [ ] Define custom error types
- [ ] Implement error wrapping
- [ ] Create database connection package
- [ ] Initialize Ent client
- [ ] Configure connection pooling
- [ ] Add database health check

### 2.3.2 Price Fetching (Week 4-5)
- [ ] Port price-fetcher.js to Go
- [ ] Create Binance API client (go-binance/v2)
- [ ] Implement getKlines function
- [ ] Implement getCurrentPrice function
- [ ] Add CoinGecko fallback
- [ ] Implement caching layer (in-memory or Redis)
- [ ] Add rate limiting
- [ ] Add retry logic with exponential backoff
- [ ] Implement error handling for API failures
- [ ] Add unit tests for price fetching

### 2.3.3 Groq AI Integration (Week 5)
- [ ] Port groq-client.js to Go
- [ ] Create Groq API client
- [ ] Implement HTTP client with timeout
- [ ] Implement JSON parsing with error handling
- [ ] Add cleanJSONResponse function equivalent
- [ ] Implement prompt building for ICT method
- [ ] Implement prompt building for Kim Nghia method
- [ ] Add retry logic for API failures
- [ ] Add confidence threshold validation
- [ ] Implement AI position management prompt
- [ ] Add unit tests for Groq client

### 2.3.4 Scheduler System (Week 5-6)
- [ ] Replace node-cron with robfig/cron
- [ ] Create analysis scheduler
- [ ] Implement Kim Nghia analysis (0,15,30,45 * * * *)
- [ ] Implement ICT analysis (disabled but preserved)
- [ ] Create price update scheduler (every 10 seconds using setInterval)
- [ ] Implement position PnL updates
- [ ] Implement SL/TP checking with candle data
- [ ] Implement pending order execution
- [ ] Create account snapshot scheduler (every 5 minutes)
- [ ] Add graceful shutdown with context cancellation
- [ ] Implement scheduler health checks
- [ ] Add logging for scheduler execution times

### 2.3.5 Paper Trading Engine (Week 6)
- [ ] Port paperTradingEngine.js to Go
- [ ] Implement position management logic
- [ ] Implement openPosition function
- [ ] Implement closePosition function
- [ ] Implement partial close functionality
- [ ] Implement SL/TP detection with candle high/low
- [ ] Implement account equity calculation
- [ ] Implement unrealized PnL calculation
- [ ] Implement realized PnL calculation
- [ ] Add cooldown system (4h after 3 consecutive losses)
- [ ] Implement auto-entry logic (80% confidence threshold)
- [ ] Implement multi-timeframe alignment check (4h, 1d)
- [ ] Implement RR ratio validation (>= 2.0)
- [ ] Implement risk-based position sizing (1% per trade)
- [ ] Add unit tests for paper trading

### 2.3.6 Testnet Integration (Week 6-7)
- [ ] Port testnetEngine.js to Go
- [ ] Implement Binance Futures Testnet client
- [ ] Implement market order execution
- [ ] Implement limit order placement
- [ ] Implement stop-loss order placement
- [ ] Implement take-profit order placement
- [ ] Implement position synchronization
- [ ] Implement order status checking
- [ ] Add webhook support for order updates
- [ ] Implement error handling for API failures
- [ ] Add unit tests for testnet integration

### 2.3.7 API Layer (Week 7)
- [x] Replace Express with Gin framework
- [x] Implement CORS middleware
- [x] Implement logging middleware
- [ ] Implement rate limiting middleware
- [ ] Implement authentication middleware (if needed)
- [x] Create analysis handler (GET /api/analysis)
- [ ] Create manual analysis trigger (POST /api/analysis/trigger) - Partial: returns 501
- [x] Create positions handler (GET/POST /api/positions)
- [x] Create position detail handler (GET /api/positions/:id)
- [x] Create accounts handler (GET/POST /api/accounts)
- [x] Create account reset handler (POST /api/accounts/reset)
- [x] Create performance metrics handler (GET /api/performance/metrics)
- [ ] Create equity curve handler (GET /api/performance/equity-curve) - Partial: returns 501
- [x] Create trade history handler (GET /api/performance/trades)
- [x] Create testnet positions handler (GET/POST /api/testnet/positions) - Partial: returns 501
- [x] Create testnet accounts handler (GET/POST /api/testnet/accounts) - Partial: returns 501
- [ ] Implement WebSocket for real-time updates
- [ ] Add API documentation (OpenAPI/Swagger)
- [ ] Add integration tests for API endpoints

### 2.3.8 AI Position Management (Week 7)
- [ ] Port AI position management logic to Go
- [ ] Implement position actions (hold, close_early, close_partial, move_sl, reverse)
- [ ] Implement order actions (hold, cancel, modify)
- [ ] Add context building (60 recent candles, positions, orders)
- [ ] Implement confidence threshold validation (ICT: 70%, Kim Nghia: 75%)
- [ ] Maintain BTC-only mode during migration
- [ ] Add unit tests for AI position management

---

## Phase 2.4: Data Migration (Week 8)

### 2.4.1 Pre-Migration Preparation
- [ ] Create full backup of SQLite database
- [ ] Validate SQLite data integrity
- [ ] Check for NULL values in required fields
- [ ] Validate foreign key relationships
- [ ] Check for duplicate records
- [ ] Verify timestamp formats
- [ ] Validate JSON fields are parseable
- [ ] Document any data quality issues

### 2.4.2 Data Export
- [ ] Export analysis_history table to CSV
- [ ] Export predictions table to CSV
- [ ] Export key_levels table to CSV
- [ ] Export ohlcv_candles table to CSV
- [ ] Export latest_prices table to CSV
- [ ] Export price_history table to CSV
- [ ] Export accounts table to CSV
- [ ] Export positions table to CSV
- [ ] Export pending_orders table to CSV
- [ ] Export account_snapshots table to CSV
- [ ] Export trade_events table to CSV
- [ ] Export testnet_accounts table to CSV
- [ ] Export testnet_positions table to CSV
- [ ] Export testnet_trade_events table to CSV
- [ ] Export testnet_account_snapshots table to CSV
- [ ] Export testnet_pending_orders table to CSV

### 2.4.3 Data Transformation
- [ ] Convert timestamps to ISO 8601 format with timezone
- [ ] Parse JSON fields and validate structure
- [ ] Handle NULL values appropriately
- [ ] Transform method_id to enum if needed
- [ ] Validate financial data precision
- [ ] Create transformation scripts
- [ ] Test transformation on sample data

### 2.4.4 Data Import
- [ ] Import analysis_history to PostgreSQL
- [ ] Import predictions to PostgreSQL
- [ ] Import key_levels to PostgreSQL
- [ ] Import ohlcv_candles to PostgreSQL
- [ ] Import latest_prices to PostgreSQL
- [ ] Import price_history to PostgreSQL
- [ ] Import accounts to PostgreSQL
- [ ] Import positions to PostgreSQL
- [ ] Import pending_orders to PostgreSQL
- [ ] Import account_snapshots to PostgreSQL
- [ ] Import trade_events to PostgreSQL
- [ ] Import testnet_accounts to PostgreSQL
- [ ] Import testnet_positions to PostgreSQL
- [ ] Import testnet_trade_events to PostgreSQL
- [ ] Import testnet_account_snapshots to PostgreSQL
- [ ] Import testnet_pending_orders to PostgreSQL

### 2.4.5 Post-Migration Validation
- [ ] Compare record counts between SQLite and PostgreSQL
- [ ] Validate foreign key relationships
- [ ] Check data types and precision
- [ ] Verify indexes are created
- [ ] Validate calculated fields (equity, PnL)
- [ ] Re-run calculations to verify accuracy
- [ ] Run checksums on exported and imported data
- [ ] Compare sample records manually
- [ ] Fix any data inconsistencies

### 2.4.6 Zero-Downtime Strategy
- [ ] Implement blue-green deployment option
- [ ] Implement shadow mode option
- [ ] Document dual-write strategy
- [ ] Test gradual traffic switch
- [ ] Keep Node.js version as rollback option

---

## Phase 2.5: Testing (Week 9-10)

### 2.5.1 Unit Testing
- [ ] Write unit tests for price fetching
- [ ] Write unit tests for Groq client
- [ ] Write unit tests for paper trading engine
- [ ] Write unit tests for testnet integration
- [ ] Write unit tests for schedulers
- [ ] Write unit tests for API handlers
- [ ] Write unit tests for AI position management
- [ ] Mock external dependencies (Groq, Binance)
- [ ] Achieve >80% code coverage
- [ ] Run tests with race detector

### 2.5.2 Integration Testing
- [ ] Set up testcontainers for PostgreSQL
- [ ] Test database operations
- [ ] Test API endpoints with httptest
- [ ] Test scheduler logic with time mocking
- [ ] Test error scenarios
- [ ] Test concurrent operations
- [ ] Test transaction rollback

### 2.5.3 Parity Testing
- [ ] Run Node.js and Go versions in parallel
- [ ] Compare analysis results
- [ ] Compare paper trading outcomes
- [ ] Compare API responses
- [ ] Compare position calculations
- [ ] Compare scheduler execution
- [ ] Document all discrepancies
- [ ] Fix all discrepancies
- [ ] Re-run parity tests

### 2.5.4 Load Testing
- [ ] Test concurrent price updates (1000 req/s)
- [ ] Test database connection pooling
- [ ] Test memory usage under load
- [ ] Verify goroutine leak prevention
- [ ] Test API response times
- [ ] Test scheduler performance
- [ ] Profile with pprof
- [ ] Optimize bottlenecks

### 2.5.5 Chaos Testing
- [ ] Test database connection failures
- [ ] Test external API failures (Groq, Binance)
- [ ] Test network partitions
- [ ] Test OOM scenarios
- [ ] Verify graceful degradation
- [ ] Test recovery mechanisms

---

## Phase 2.6: Deployment (Week 11)

### 2.6.1 Build Process
- [ ] Create Dockerfile for Go application
- [ ] Set up multi-stage build
- [ ] Optimize image size
- [ ] Configure health checks
- [ ] Implement graceful shutdown
- [ ] Test Docker build locally
- [ ] Test Docker run locally

### 2.6.2 Deployment Configuration
- [ ] Create docker-compose.yml for production
- [ ] Configure PostgreSQL with pgBouncer
- [ ] Configure environment variables
- [ ] Set up volume mounts
- [ ] Configure network isolation
- [ ] Set up log aggregation

### 2.6.3 Monitoring
- [ ] Add Prometheus metrics
- [ ] Implement structured logging
- [ ] Set up alerting for critical errors
- [ ] Monitor database connections
- [ ] Monitor goroutine count
- [ ] Monitor memory usage
- [ ] Monitor API response times
- [ ] Set up dashboard (Grafana)

### 2.6.4 Rollback Plan
- [ ] Keep Node.js version as fallback
- [ ] Document rollback procedure
- [ ] Test rollback process
- [ ] Set up feature flags
- [ ] Create rollback script
- [ ] Test rollback script

### 2.6.5 Production Deployment
- [ ] Deploy to staging environment first
- [ ] Run parity tests in staging
- [ ] Get approval for production deployment
- [ ] Deploy to production
- [ ] Monitor for 24 hours
- [ ] Address any issues
- [ ] Document deployment

### 2.6.6 Post-Deployment
- [ ] Verify all features work
- [ ] Verify API responses match
- [ ] Verify paper trading works
- [ ] Verify testnet integration works
- [ ] Verify multi-method analysis works
- [ ] Verify AI position management works
- [ ] Verify BTC-only mode is maintained
- [ ] Collect performance metrics
- [ ] Document lessons learned

---

## Success Criteria Checklist

### Functional Requirements
- [ ] All existing features work identically
- [ ] API responses match Node.js version
- [ ] Paper trading produces same results
- [ ] Testnet integration works correctly
- [ ] Multi-method analysis produces same outputs
- [ ] AI position management works correctly
- [ ] BTC-only mode is maintained

### Performance Requirements
- [ ] API response time < 100ms (p95)
- [ ] Memory usage < 512MB
- [ ] CPU usage < 50% under normal load
- [ ] Database queries < 10ms (p95)
- [ ] Support 1000 concurrent connections

### Reliability Requirements
- [ ] 99.9% uptime
- [ ] Zero data loss during migration
- [ ] Graceful handling of external API failures
- [ ] Automatic recovery from crashes
- [ ] No goroutine leaks

### Maintainability Requirements
- [ ] Code coverage > 80%
- [ ] All code documented
- [ ] Clear error messages
- [ ] Structured logging
- [ ] Easy to add new analysis methods

---

## Weekly Review Template

### Week X Review
**Date:** [Date]
**Attendees:** [Names]

#### Completed Tasks
- [ ] Task 1
- [ ] Task 2

#### Blocked Tasks
- [ ] Task 1 - Reason: [Explanation]

#### Next Week Goals
- [ ] Goal 1
- [ ] Goal 2

#### Risks/Issues
- [ ] Risk 1 - Mitigation: [Plan]

#### Decisions Made
- [ ] Decision 1

#### Action Items
- [ ] Action 1 - Owner: [Name] - Due: [Date]
