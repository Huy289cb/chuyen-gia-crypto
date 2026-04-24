# Binance Futures Integration (REST API)

## Tổng quan

Hệ thống tích hợp Binance Futures cho phép thực hiện giao dịch thực tế trên môi trường demo/mainnet song song với paper trading system. Điều này giúp so sánh hiệu quả giữa 2 hệ thống trước khi triển khai lên mainnet.

**Phạm vi hiện tại:**
- BTC-only trading (BTCUSDT)
- Kim Nghia method analysis
- Binance Futures REST API (Official REST API - No SDK dependency)
- Chạy song song với paper trading
- Support cả Demo Trading và Mainnet (switch bằng environment variable)

---

## Architecture

### Components

1. **Binance REST API Modules** (`backend/src/services/binance/`)
   - `signer.js` - HMAC SHA256 signature generation
   - `config.js` - Configuration with environment variables
   - `endpoints.js` - API endpoints definitions
   - `client.js` - Core HTTP client with signature & retry logic
   - `market.js` - Market data functions (getServerTime, getKlines, getPrice)
   - `account.js` - Account functions (getAccount, getBalance, getPositionRisk)
   - `trading.js` - Trading functions (setLeverage, setMarginType, placeOrder, cancelOrder, etc.)
   - `stream.js` - User data stream (listenKey management)

2. **Binance Client Service** (`backend/src/services/binanceClient.js`)
   - Wrapper around REST API modules
   - Error handling và retry logic
   - Rate limiting theo Binance API limits
   - **No SDK dependency** - Uses official REST API directly

2. **Testnet Engine** (`backend/src/services/testnetEngine.js`)
   - Position management (open/close/update)
   - SL/TP management với partial TP support
   - Account sync với Binance
   - PnL calculation

3. **Testnet Database** (`backend/src/db/testnetDatabase.js`)
   - CRUD operations cho testnet data
   - Tables: testnet_accounts, testnet_positions, testnet_trade_events, testnet_account_snapshots

4. **Scheduler Integration**
   - Auto-entry logic trong `backend/src/scheduler.js`
   - Price update scheduler trong `backend/src/schedulers/priceUpdateScheduler.js`

5. **API Routes** (`backend/src/routes/testnet.js`)
   - Endpoints để query testnet data
   - Manual sync endpoint

---

## Database Schema

### testnet_accounts

```sql
CREATE TABLE testnet_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
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
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, method_id)
)
```

### testnet_positions

```sql
CREATE TABLE testnet_positions (
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

### testnet_trade_events

```sql
CREATE TABLE testnet_trade_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### testnet_account_snapshots

```sql
CREATE TABLE testnet_account_snapshots (
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

---

## Configuration

### Environment Variables

Thêm vào `backend/.env`:

```bash
# Binance Futures Configuration (REST API)
BINANCE_ENABLED=true
BINANCE_BASE_URL=https://demo-fapi.binance.com  # Demo Trading
# BINANCE_BASE_URL=https://fapi.binance.com  # Mainnet
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_secret_key
BINANCE_SYMBOL=BTCUSDT
BINANCE_LEVERAGE=20
BINANCE_RECV_WINDOW=5000
```

### Getting API Keys

**Demo Trading:**
1. Truy cập [Binance Futures Testnet](https://testnet.binancefuture.com/)
2. Đăng ký tài khoản testnet
3. Vào API Management → Create API
4. Lưu API Key và Secret Key vào environment variables

**Mainnet:**
1. Truy cập [Binance API Management](https://www.binance.com/en/my/settings/api-management)
2. Enable Futures permission
3. Create API key
4. Lưu API Key và Secret Key vào environment variables

---

## API Reference

### Binance Client Functions

#### `initTestnetClient()`
Khởi tạo Binance Testnet client với API keys từ environment.

**Returns:** `Futures` client instance hoặc `null` nếu disabled/invalid config

#### `testConnection(client)`
Test kết nối với Binance Testnet API.

**Parameters:**
- `client` - Binance client instance

**Returns:** `{ success: boolean, serverTime?: number, error?: string }`

#### `getAccountBalance(client)`
Lấy số dư tài khoản từ Binance.

**Parameters:**
- `client` - Binance client instance

**Returns:** `{ walletBalance, availableBalance, totalWalletBalance, totalUnrealizedProfit }`

#### `placeMarketOrder(client, symbol, side, quantity)`
Đặt lệnh market.

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair (e.g., 'BTCUSDT')
- `side` - 'BUY' hoặc 'SELL'
- `quantity` - Số lượng (in BTC)

**Returns:** Order object với orderId, executedQty, status

#### `placeStopLossOrder(client, symbol, side, quantity, stopPrice)`
Đặt lệnh stop loss (STOP_MARKET).

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair
- `side` - 'BUY' hoặc 'SELL'
- `quantity` - Số lượng
- `stopPrice` - Stop loss price

**Returns:** Order object

#### `placeTakeProfitOrder(client, symbol, side, quantity, price)`
Đặt lệnh take profit (TAKE_PROFIT_MARKET).

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair
- `side` - 'BUY' hoặc 'SELL'
- `quantity` - Số lượng
- `price` - Take profit price

**Returns:** Order object

#### `cancelOrder(client, symbol, orderId)`
Hủy lệnh theo ID.

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair
- `orderId` - Order ID

**Returns:** Cancelled order object

#### `getOpenOrders(client, symbol)`
Lấy danh sách lệnh đang mở.

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair

**Returns:** Array of order objects

#### `setLeverage(client, symbol, leverage)`
Set leverage cho symbol.

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair
- `leverage` - Leverage multiplier (1-125)

**Returns:** Leverage info object

#### `setMarginType(client, symbol, marginType)`
Set margin type (ISOLATED hoặc CROSSED).

**Parameters:**
- `client` - Binance client instance
- `symbol` - Trading pair
- `marginType` - 'ISOLATED' hoặc 'CROSSED'

**Returns:** Margin type info

### Testnet Engine Functions

#### `initTestnetEngine()`
Khởi tạo testnet engine và test kết nối.

**Returns:** Testnet client instance hoặc `null`

#### `openTestnetPosition(db, account, positionData, predictionId, methodId)`
Mở position mới trên testnet.

**Parameters:**
- `db` - SQLite database instance
- `account` - Testnet account object
- `positionData` - `{ side, entry_price, stop_loss, take_profit, size_usd, risk_usd, risk_percent, expected_rr }`
- `predictionId` - ID của prediction liên quan
- `methodId` - Method ID (e.g., 'kim_nghia')

**Returns:** Position object hoặc `null` (nếu cooldown)

**Process:**
1. Validate position size vs account balance
2. Check cooldown status
3. Place market order
4. Place SL/TP orders
5. Save to database
6. Record trade event

#### `closeTestnetPositionEngine(db, position, currentPrice, closeReason)`
Đóng position trên testnet.

**Parameters:**
- `db` - SQLite database instance
- `position` - Position object
- `currentPrice` - Current price
- `closeReason` - Reason for closing ('stop_loss', 'take_profit', 'manual', 'ai_close_early', etc.)

**Returns:** `{ realizedPnl, isWin }`

**Process:**
1. Cancel SL/TP orders
2. Place opposite market order
3. Calculate realized PnL
4. Update position status
5. Update account balance
6. Update account stats
7. Record trade event

#### `updateTestnetPositionSL(db, position, newSL, reason)`
Update stop loss cho position.

**Parameters:**
- `db` - SQLite database instance
- `position` - Position object
- `newSL` - New stop loss price
- `reason` - Reason for update

**Process:**
1. Cancel existing SL order
2. Place new SL order
3. Update database
4. Record trade event

#### `checkTestnetSLTP(db, position, currentPrice)`
Check nếu SL/TP bị hit.

**Parameters:**
- `db` - SQLite database instance
- `position` - Position object
- `currentPrice` - Current price

**Returns:** `'stop_loss'`, `'take_profit'`, `'partial_tp_N'`, hoặc `null`

**Process:**
- Check SL hit → close position
- Check TP levels → handle partial TP
- Support partial TP cho ICT method

#### `syncTestnetAccount(db, account)`
Sync account với Binance.

**Parameters:**
- `db` - SQLite database instance
- `account` - Account object

**Returns:** Balance object

**Process:**
1. Fetch real balance from Binance
2. Detect discrepancies
3. Auto-correct database nếu cần
4. Sync positions và order status
5. Create account snapshot

#### `updateTestnetPositionsPnL(db, currentPrice)`
Update unrealized PnL cho tất cả open positions.

**Parameters:**
- `db` - SQLite database instance
- `currentPrice` - Current price

**Process:**
1. Get all open positions
2. Calculate unrealized PnL
3. Update positions
4. Check SL/TP
5. Update account equity

---

## API Endpoints

### GET /api/testnet/accounts
Lấy danh sách testnet accounts.

**Response:**
```json
{
  "accounts": [
    {
      "id": 1,
      "symbol": "BTC",
      "method_id": "kim_nghia",
      "starting_balance": 100,
      "current_balance": 105.5,
      "equity": 110,
      "unrealized_pnl": 4.5,
      "realized_pnl": 5.5,
      "total_trades": 10,
      "winning_trades": 7,
      "losing_trades": 3,
      "max_drawdown": 2.5,
      "consecutive_losses": 0
    }
  ]
}
```

### GET /api/testnet/positions
Lấy danh sách testnet positions.

**Query params:**
- `status` - 'open' hoặc 'closed' (optional)
- `account_id` - Account ID (optional)

**Response:**
```json
{
  "positions": [
    {
      "id": 1,
      "position_id": "test_pos_123",
      "account_id": 1,
      "symbol": "BTCUSDT",
      "side": "BUY",
      "entry_price": 50000,
      "current_price": 51000,
      "stop_loss": 49000,
      "take_profit": 52000,
      "entry_time": "2026-04-24T12:00:00.000Z",
      "status": "open",
      "size_usd": 100,
      "size_qty": 0.002,
      "risk_usd": 10,
      "risk_percent": 10,
      "expected_rr": 2.0,
      "realized_pnl": 0,
      "unrealized_pnl": 2,
      "binance_order_id": "12345",
      "binance_sl_order_id": "12346",
      "binance_tp_order_id": "12347"
    }
  ]
}
```

### GET /api/testnet/positions/:id
Lấy chi tiết position theo ID.

### GET /api/testnet/performance/:accountId
Lấy performance metrics cho account.

**Response:**
```json
{
  "total_trades": 10,
  "winning_trades": 7,
  "losing_trades": 3,
  "win_rate": 70,
  "total_pnl": 5.5,
  "avg_win": 2.5,
  "avg_loss": -1.5,
  "profit_factor": 5.83,
  "max_drawdown": 2.5,
  "sharpe_ratio": 1.2
}
```

### GET /api/testnet/equity-curve/:accountId
Lấy equity curve data cho account.

**Response:**
```json
{
  "snapshots": [
    {
      "timestamp": "2026-04-24T12:00:00.000Z",
      "balance": 100,
      "equity": 100
    },
    {
      "timestamp": "2026-04-24T12:05:00.000Z",
      "balance": 100,
      "equity": 102
    }
  ]
}
```

### GET /api/testnet/trades/:accountId
Lấy trade history cho account.

**Response:**
```json
{
  "trades": [
    {
      "position_id": "test_pos_123",
      "side": "BUY",
      "entry_price": 50000,
      "exit_price": 51000,
      "entry_time": "2026-04-24T12:00:00.000Z",
      "exit_time": "2026-04-24T13:00:00.000Z",
      "realized_pnl": 2,
      "close_reason": "take_profit"
    }
  ]
}
```

### POST /api/testnet/reset/:accountId
Reset account về starting balance.

**Response:**
```json
{
  "success": true,
  "message": "Account reset successfully"
}
```

### GET /api/testnet/sync/:accountId
Manual sync account với Binance.

**Response:**
```json
{
  "success": true,
  "balance": {
    "availableBalance": 950,
    "totalWalletBalance": 1000
  },
  "synced_at": "2026-04-24T12:00:00.000Z"
}
```

---

## Risk Management

### Position Sizing
- Position size dựa trên `risk_percent` (default 10% cho Kim Nghia method)
- Validate position size vs account balance trước khi mở lệnh
- Leverage support (default 1x)

### Stop Loss / Take Profit
- SL/TP orders được đặt ngay sau khi mở position
- Support partial TP cho ICT method (50% @ 1:1 R:R, 50% @ 2:1 R:R)
- Auto-close khi SL/TP hit

### Cooldown System
- Cooldown sau 3 consecutive losses
- Default cooldown: 4 hours
- Account không mở position mới khi trong cooldown

### Account Sync
- Auto-sync mỗi 5 phút
- Manual sync available qua API
- Auto-correction cho balance discrepancies

---

## Troubleshooting

### Connection Issues

**Problem:** Cannot connect to Binance Testnet
```
[BinanceClient] Connection test failed: ...
```

**Solution:**
1. Check API keys are correct
2. Verify testnet URL is correct
3. Check network connectivity
4. Verify testnet account is active

### Order Placement Issues

**Problem:** Order placement fails
```
[BinanceClient] Failed to place market order: ...
```

**Solution:**
1. Check account has sufficient balance
2. Verify symbol is correct (BTCUSDT)
3. Check leverage settings
4. Verify order parameters are valid

### Position Sync Issues

**Problem:** Balance discrepancy detected
```
[TestnetEngine] Balance discrepancy detected for account X
```

**Solution:**
1. System auto-corrects automatically
2. Check trade events table for sync history
3. Manual sync via API endpoint if needed
4. Verify no external manual trades on testnet

### Rate Limit Issues

**Problem:** Rate limit hit
```
[BinanceClient] Rate limit hit, waiting ...
```

**Solution:**
1. System has built-in retry logic
2. Reduce frequency of API calls
3. Check Binance rate limits documentation
4. Implement request queuing if needed

---

## Testing

### Unit Tests
```bash
cd backend
npm test -- binanceClient.test.js
npm test -- testnetEngine.test.js
```

### Integration Tests
```bash
npm test -- testnetFlow.test.js
```

### Manual Testing Checklist
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

---

## Deployment Considerations

### Security
- API keys stored in environment variables (never commit)
- Implement API key rotation mechanism
- IP whitelisting cho production (Mainnet phase)
- Use HTTPS cho all API calls

### Monitoring
- Log all Binance API calls
- Monitor rate limit usage
- Alert on API failures
- Track sync discrepancies

### Backup & Recovery
- Database backup strategy
- Position recovery mechanism nếu API down
- Manual override capability
- Emergency stop functionality

---

## Future Enhancements

### Phase 2 (Mainnet Integration)
- Multi-symbol support (ETH, SOL, etc.)
- Higher leverage options
- Advanced order types (OCO, trailing stop)
- WebSocket integration cho real-time updates

### Phase 3 (Advanced Features)
- Grid trading
- DCA (Dollar Cost Averaging)
- Portfolio management
- Risk analytics dashboard

---

## References

- [Binance Futures API Documentation](https://binance-docs.github.io/apidocs/futures/en/)
- [Binance Testnet](https://testnet.binancefuture.com/)
- [Binance Mainnet](https://www.binance.com/en/futures)
- [Phase 1 Implementation Plan](./plans/phase1-binance-testnet-integration.md)

## Changelog

### [24/04/2026] - REST API Refactoring
- Removed SDK dependency (`binance` package)
- Implemented official REST API modules in `backend/src/services/binance/`
- Added HMAC SHA256 signature generation
- Added retry logic with error code handling (-1021, -2015, -1008)
- Updated environment variables to support both Demo and Mainnet
- Switch between environments by changing `BINANCE_BASE_URL`
- Added `axios` as HTTP client dependency
