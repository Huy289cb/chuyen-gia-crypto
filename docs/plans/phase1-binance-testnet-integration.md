# Phase 1: Binance Futures Testnet Integration Plan

Tích hợp Binance Futures Testnet vào backend hiện tại, chạy song song với paper trading system để so sánh kết quả, sử dụng Kim Nghia analysis cho BTC.

## Tổng quan

**Mục tiêu:** Xây dựng module Binance Futures Testnet tích hợp vào backend Node.js hiện tại, thực hiện lệnh trading thực tế trên testnet song song với paper trading, sử dụng cùng nguồn analysis từ Kim Nghia scheduler.

**Phạm vi:** BTC-only, Kim Nghia method, Binance Testnet API, chạy song song với paper trading.

---

# Phase 1.1: Core Functionality (Priority 1)
**Mục tiêu:** Xây dựng nền tảng cốt lõi để kết nối và thực hiện lệnh trên Binance Testnet.
**Ước tính:** 2-3 ngày

## 1.1. Cấu hình môi trường & Dependencies

### 1.1.1 Cài đặt thư viện Binance
- Cài đặt `binance-connector` hoặc `@binance/connector` package
- Thêm vào `backend/package.json` dependencies
- Test connection với Binance Testnet API

### 1.1.2 Cấu hình Environment Variables
Thêm vào `backend/.env.example`:
```
# Binance Futures Testnet Configuration
BINANCE_TESTNET_API_KEY=your_testnet_api_key
BINANCE_TESTNET_SECRET_KEY=your_testnet_secret_key
BINANCE_TESTNET_ENABLED=true
BINANCE_TESTNET_SYMBOL=BTCUSDT
BINANCE_TESTNET_LEVERAGE=1
```

### 1.1.3 Tạo config file
- Tạo `backend/src/config/binance.js`
- Export cấu hình cho Testnet (base URL, endpoints, rate limits)
- Validate API keys trên startup

## 1.2. Binance Client Service Layer

### 1.2.1 Tạo Binance Client Module
File: `backend/src/services/binanceClient.js`

**Functions cần thiết:**
- `initTestnetClient()` - Khởi tạo client với API keys
- `testConnection()` - Ping API để kiểm tra kết nối
- `getAccountBalance()` - Lấy số dư USDT trên testnet
- `getCurrentPosition(symbol)` - Lấy position hiện tại
- `placeMarketOrder(symbol, side, quantity)` - Đặt lệnh market
- `placeLimitOrder(symbol, side, quantity, price)` - Đặt lệnh limit
- `placeStopLossOrder(symbol, side, quantity, stopPrice)` - Đặt SL order
- `placeTakeProfitOrder(symbol, side, quantity, price)` - Đặt TP order
- `cancelOrder(symbol, orderId)` - Hủy lệnh
- `cancelAllOrders(symbol)` - Hủy tất cả lệnh
- `getOpenOrders(symbol)` - Lấy danh sách lệnh đang mở
- `getPositionRisk(symbol)` - Lấy thông tin rủi ro position

### 1.2.2 Error Handling & Retry Logic
- Implement retry mechanism cho API failures
- Rate limiting theo Binance limits (weight-based)
- Log chi tiết mọi API call và response
- Fallback mechanism khi API down

## 1.3. Database Schema cho Testnet

### 1.3.1 Tạo bảng mới trong migrations
File: `backend/src/db/migrations.js`

**Bảng `testnet_accounts`:**
```sql
CREATE TABLE IF NOT EXISTS testnet_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  method_id TEXT NOT NULL,
  starting_balance REAL NOT NULL,
  current_balance REAL NOT NULL,
  equity REAL NOT NULL,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  max_drawdown REAL DEFAULT 0,
  consecutive_losses INTEGER DEFAULT 0,
  last_trade_time DATETIME,
  cooldown_until DATETIME,
  api_key_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**Bảng `testnet_positions`:**
```sql
CREATE TABLE IF NOT EXISTS testnet_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id TEXT UNIQUE NOT NULL,
  account_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL DEFAULT 0,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  entry_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'open',
  size_usd REAL NOT NULL,
  size_qty REAL NOT NULL,
  risk_usd REAL NOT NULL,
  risk_percent REAL NOT NULL,
  expected_rr REAL NOT NULL,
  realized_pnl REAL DEFAULT 0,
  unrealized_pnl REAL DEFAULT 0,
  close_price REAL,
  close_time DATETIME,
  close_reason TEXT,
  linked_prediction_id INTEGER,
  binance_order_id TEXT,
  binance_sl_order_id TEXT,
  binance_tp_order_id TEXT,
  FOREIGN KEY (account_id) REFERENCES testnet_accounts(id)
)
```

**Bảng `testnet_trade_events`:**
```sql
CREATE TABLE IF NOT EXISTS testnet_trade_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**Bảng `testnet_account_snapshots`:**
```sql
CREATE TABLE IF NOT EXISTS testnet_account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  balance REAL NOT NULL,
  equity REAL NOT NULL,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  open_positions_count INTEGER DEFAULT 0,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES testnet_accounts(id)
)
```

### 1.3.2 Database Functions
File: `backend/src/db/testnetDatabase.js`

**CRUD Operations:**
- `getOrCreateTestnetAccount(db, symbol, methodId)`
- `getTestnetAccount(db, symbol, methodId)`
- `updateTestnetAccountBalance(db, accountId, newBalance, pnl)`
- `createTestnetPosition(db, positionData)`
- `getTestnetPositions(db, filters)`
- `updateTestnetPosition(db, positionId, updates)`
- `closeTestnetPosition(db, positionId, closePrice, closeReason)`
- `recordTestnetTradeEvent(db, positionId, eventType, eventData)`
- `createTestnetAccountSnapshot(db, accountId)`
- `getTestnetPerformanceMetrics(db, accountId)`

## 1.4. Testnet Trading Engine

### 1.4.1 Tạo Testnet Engine Module
File: `backend/src/services/testnetEngine.js`

**Core Functions:**
- `openTestnetPosition(db, account, positionData, predictionId, methodId)`
  - Validate position size vs account balance
  - Calculate quantity based on leverage
  - Place market order via Binance API
  - Place SL/TP orders via Binance API
  - Save position to database
  - Update account balance

- `closeTestnetPosition(db, position, currentPrice, closeReason)`
  - Cancel SL/TP orders
  - Place opposite market order to close
  - Calculate realized PnL
  - Update position status
  - Update account balance
  - Record trade event

- `updateTestnetPositionSL(db, position, newSL, reason)`
  - Cancel existing SL order
  - Place new SL order
  - Update database

- `checkTestnetSLTP(db, position, currentPrice)`
  - Check if SL/TP hit based on current price
  - Auto-close if hit
  - Handle partial TP (nếu có)

- `syncTestnetAccount(db, account)`
  - Fetch real balance from Binance
  - Sync with database
  - Detect discrepancies

### 1.4.2 Risk Management
- Validate position size theo leverage
- Check margin requirements
- Implement position sizing logic (giống paper trading)
- Cooldown system sau consecutive losses

## 1.5. Integration với Scheduler

### 1.5.1 Modify `backend/src/scheduler.js`
Trong `runMethodAnalysis()` function:

**Sau khi evaluateAutoEntry cho paper trading:**
```javascript
// Step 5: Testnet auto-entry (if enabled)
if (process.env.BINANCE_TESTNET_ENABLED === 'true') {
  try {
    const { evaluateAutoEntry } = await import('./services/autoEntryLogic.js');
    const { openTestnetPosition } = await import('./services/testnetEngine.js');
    const { getOrCreateTestnetAccount, getTestnetPositions } = await import('./db/testnetDatabase.js');
    
    // Get or create testnet account
    const testnetAccount = await getOrCreateTestnetAccount(db, 'BTC', methodId);
    
    // Get open testnet positions
    const openTestnetPositions = await getTestnetPositions(db, { account_id: testnetAccount.id, status: 'open' });
    
    // Evaluate auto-entry for testnet (reuse same logic)
    const testnetDecision = await evaluateAutoEntry(analysis.btc, testnetAccount, openTestnetPositions, method, db);
    
    if (testnetDecision.shouldEnter && testnetDecision.suggestedPosition) {
      const position = testnetDecision.suggestedPosition;
      await openTestnetPosition(db, testnetAccount, position, btcPredictionId, methodId);
      console.log(`[Scheduler][${method.name}] Testnet order executed: ${position.side} @ ${position.entry_price}`);
    }
  } catch (testnetError) {
    console.error(`[Scheduler][${method.name}] Testnet execution failed:`, testnetError.message);
  }
}
```

### 1.5.2 Position Decisions cho Testnet
**Process AI position_decisions cho testnet positions:**
- Tương tự như paper trading logic
- Gọi `closeTestnetPosition`, `updateTestnetPositionSL`, etc.
- Log actions riêng cho testnet

---

# Phase 1.2: Monitoring & Sync (Priority 2)
**Mục tiêu:** Xây dựng hệ thống monitoring và đồng bộ dữ liệu real-time cho testnet positions.
**Ước tính:** 1-2 ngày

## 2.1. Price Update Scheduler cho Testnet

### 2.1.1 Modify `backend/src/schedulers/priceUpdateScheduler.js`
**Thêm testnet position monitoring:**
- Fetch current price từ Binance API
- Update unrealized PnL cho testnet positions
- Check SL/TP hit
- Sync account balance từ Binance
- Create account snapshots mỗi 5 phút

### 2.1.2 Websocket Integration (Optional - Phase 2)
- Subscribe to Binance WebSocket cho real-time price updates
- Update positions in real-time
- Faster SL/TP detection

## 2.2. Account Sync Mechanism

### 2.2.1 Sync Function Implementation
File: `backend/src/services/testnetEngine.js`
- `syncTestnetAccount(db, account)` - Fetch real balance from Binance
- Detect discrepancies giữa database và Binance
- Auto-correction cho mismatched data
- Log sync events

### 2.2.2 Manual Sync Endpoint
- API endpoint để trigger manual sync
- Frontend button để user sync khi cần
- Display sync status và last sync time

## 2.3. SL/TP Monitoring

### 2.3.1 Real-time SL/TP Check
- Check SL/TP trên mỗi price update (30s)
- Auto-close position khi hit
- Handle partial TP (nếu có)
- Send notifications khi SL/TP hit

### 2.3.2 Order Status Tracking
- Track status của SL/TP orders trên Binance
- Detect nếu orders bị cancelled/filled
- Re-place orders nếu cần
- Log order lifecycle events

---

# Phase 1.3: API & Frontend (Priority 3)
**Mục tiêu:** Xây dựng API endpoints và frontend components để hiển thị và quản lý testnet data.
**Ước tính:** 2-3 ngày

## 3.1. API Endpoints cho Testnet

### 3.1.1 Tạo routes file
File: `backend/src/routes/testnet.js`

**Endpoints:**
- `GET /api/testnet/accounts` - List testnet accounts
- `GET /api/testnet/positions` - List testnet positions
- `GET /api/testnet/positions/:id` - Get position detail
- `GET /api/testnet/performance/:accountId` - Performance metrics
- `GET /api/testnet/equity-curve/:accountId` - Equity curve data
- `GET /api/testnet/trades/:accountId` - Trade history
- `POST /api/testnet/reset/:accountId` - Reset account
- `GET /api/testnet/sync/:accountId` - Manual sync with Binance

### 3.1.2 Register routes
Thêm vào `backend/src/routes.js` hoặc `backend/src/index.js`

## 3.2. Frontend Integration

### 3.2.1 Testnet Components ✅ COMPLETED
File: `frontend/app/components/crypto/TestnetPanel.tsx`
- Display testnet account info (balance, equity, PnL)
- List open testnet positions with close button
- Show testnet trade history
- Display pending orders with cancel button
- Sync button để manual sync với Binance
- Reset button để reset account về 100U

### 3.2.2 Comparison Dashboard ✅ COMPLETED
File: `frontend/app/components/crypto/ComparisonDashboard.tsx`
- Side-by-side comparison: Paper Trading vs Testnet
- Metrics: Balance, Equity, Win Rate, Profit Factor, Max Drawdown
- Equity curve chart (both systems) với lightweight-charts
- Trade history table (both systems)
- Performance summary table
- Position comparison cards

### 3.2.3 useTestnet Hook ✅ COMPLETED
File: `frontend/app/hooks/useTestnet.ts`
- Fetch account, positions, pending orders, performance, equity curve, trade history
- Auto-refresh every 1 minute
- Functions: syncAccount, resetAccount, closePosition, cancelPendingOrder
- Type definitions: TestnetAccount, TestnetPosition, TestnetPendingOrder, TestnetPerformance, TestnetSnapshot

### 3.2.4 Main Dashboard Integration ✅ COMPLETED
File: `frontend/app/page.tsx`
- Tab navigation: Paper Trading | Binance Testnet | Comparison
- TestnetPanel hiển thị khi tab "Binance Testnet" được chọn
- ComparisonDashboard hiển thị khi tab "Comparison" được chosen

### 3.2.3 Update Main Dashboard
File: `frontend/app/page.tsx`
- Add tab/toggle để switch giữa Paper Trading và Testnet
- Hoặc hiển thị cả 2 song song
- Add indicator để phân biệt 2 systems

### 3.2.4 Create Testnet Hook
File: `frontend/app/hooks/useTestnet.ts`
- Fetch testnet accounts
- Fetch testnet positions
- Fetch testnet performance
- Sync testnet account

---

# Phase 1.4: Testing & Documentation (Priority 4)
**Mục tiêu:** Testing, validation và documentation hoàn chỉnh cho hệ thống.
**Ước tính:** 1-2 ngày

## 4.1. Testing & Validation

### 4.1.1 Unit Tests
File: `backend/tests/unit/testnetClient.test.js`
- Test Binance client functions
- Test error handling
- Test retry logic

File: `backend/tests/unit/testnetEngine.test.js`
- Test position opening logic
- Test position closing logic
- Test PnL calculation
- Test risk management

### 4.1.2 Integration Tests
File: `backend/tests/integration/testnetFlow.test.js`
- Test full flow: analysis → auto-entry → Binance order → database save
- Test SL/TP execution
- Test position decisions
- Test account sync

### 4.1.3 Manual Testing Checklist
- [ ] Testnet API connection successful
- [ ] Account balance fetched correctly
- [ ] Market order placed successfully
- [ ] SL/TP orders placed successfully
- [ ] Position saved to database
- [ ] Position closed correctly
- [ ] PnL calculated correctly
- [ ] Account balance updated
- [ ] Frontend displays correct data
- [ ] Comparison dashboard shows both systems

## 4.2. Documentation

### 4.2.1 Update Documentation
File: `docs/binance-testnet-integration.md`
- Architecture overview
- API reference
- Configuration guide
- Troubleshooting guide

### 4.2.2 Update README
- Add Binance Testnet section
- Update setup instructions
- Add environment variables documentation

### 4.2.3 Update .env.example
- Add all new environment variables
- Add comments explaining each variable

## 4.3. Deployment Considerations

### 4.3.1 Security
- API keys stored in environment variables (never commit)
- Implement API key rotation mechanism
- IP whitelisting cho production (Mainnet phase)

### 4.3.2 Monitoring
- Log all Binance API calls
- Monitor rate limit usage
- Alert on API failures
- Track sync discrepancies

### 4.3.3 Backup & Recovery
- Database backup strategy
- Position recovery mechanism nếu API down
- Manual override capability

---

## Tổng kết

**Timeline:**
- **Phase 1.1 (Core):** 2-3 ngày
- **Phase 1.2 (Monitoring):** 1-2 ngày
- **Phase 1.3 (API & Frontend):** 2-3 ngày
- **Phase 1.4 (Testing & Docs):** 1-2 ngày

**Total:** 6-10 ngày cho Phase 1 complete
