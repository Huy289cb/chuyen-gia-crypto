# Paper Trading API Specification

## Base URL
```
http://localhost:3000/api
```

## Authentication
Currently no authentication required. All endpoints are public.

## Response Format

All responses follow this structure:

```json
{
  "success": true|false,
  "data": {},
  "error": "Error message if success=false",
  "meta": {}
}
```

## Endpoints

### Positions

#### GET /api/positions

Get all positions with optional filters.

**Query Parameters:**
- `symbol` (optional): Filter by symbol (e.g., BTC, ETH)
- `status` (optional): Filter by status (open, closed, stopped, taken_profit, closed_manual, expired)
- `method` (optional): Filter by trading method (ict, kim_nghia) - defaults to ict

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "position_id": "uuid-here",
      "account_id": 1,
      "symbol": "BTC",
      "side": "long",
      "entry_price": 67000,
      "stop_loss": 66500,
      "take_profit": 68000,
      "entry_time": "2026-04-07T12:00:00.000Z",
      "status": "open",
      "size_usd": 134,
      "size_qty": 0.002,
      "risk_usd": 1,
      "risk_percent": 1,
      "expected_rr": 2.0,
      "realized_pnl": 0,
      "unrealized_pnl": 5.2,
      "close_price": null,
      "close_time": null,
      "close_reason": null,
      "linked_prediction_id": 123
    }
  ],
  "meta": {
    "count": 1,
    "filters": { "symbol": "BTC", "status": "open" }
  }
}
```

#### GET /api/positions/:id

Get a specific position by ID.

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "position_id": "uuid-here",
    "account_id": 1,
    "symbol": "BTC",
    "side": "long",
    "entry_price": 67000,
    "stop_loss": 66500,
    "take_profit": 68000,
    "entry_time": "2026-04-07T12:00:00.000Z",
    "status": "open",
    "size_usd": 134,
    "size_qty": 0.002,
    "risk_usd": 1,
    "risk_percent": 1,
    "expected_rr": 2.0,
    "realized_pnl": 0,
    "unrealized_pnl": 5.2,
    "close_price": null,
    "close_time": null,
    "close_reason": null,
    "linked_prediction_id": 123
  }
}
```

#### POST /api/positions/open

Open a new position (manual entry).

**Request Body:**
```json
{
  "symbol": "BTC",
  "side": "long",
  "entry_price": 67000,
  "stop_loss": 66500,
  "take_profit": 68000,
  "size_usd": 134
}
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "position_id": "uuid-here",
    ...
  },
  "message": "Position opened successfully"
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Maximum positions already open for this symbol"
}
```

#### POST /api/positions/close/:id

Close a position manually.

**Request Body:**
```json
{
  "reason": "manual"
}
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "closed_manual",
    "close_price": 67500,
    "close_time": "2026-04-07T14:00:00.000Z",
    "close_reason": "manual",
    ...
  },
  "realized_pnl": 10,
  "is_win": true,
  "message": "Position closed successfully"
}
```

### Accounts

#### GET /api/accounts

Get all paper trading accounts.

**Query Parameters:**
- `method` (optional): Filter by trading method (ict, kim_nghia) - defaults to ict

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "symbol": "BTC",
      "method_id": "ict",
      "starting_balance": 100,
      "current_balance": 95.5,
      "equity": 100.2,
      "unrealized_pnl": 4.7,
      "realized_pnl": -4.5,
      "total_trades": 5,
      "winning_trades": 3,
      "losing_trades": 2,
      "max_drawdown": 5.2,
      "consecutive_losses": 0,
      "last_trade_time": "2026-04-07T14:00:00.000Z",
      "cooldown_until": null,
      "created_at": "2026-04-01T00:00:00.000Z",
      "updated_at": "2026-04-07T14:00:00.000Z"
    },
    {
      "id": 2,
      "symbol": "BTC",
      "method_id": "kim_nghia",
      "starting_balance": 100,
      ...
    }
  ],
  "meta": {
    "count": 2
  }
}
```

#### GET /api/accounts/:symbol

Get account by symbol.

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "symbol": "BTC",
    "starting_balance": 100,
    "current_balance": 95.5,
    "equity": 100.2,
    "unrealized_pnl": 4.7,
    "realized_pnl": -4.5,
    "total_trades": 5,
    "winning_trades": 3,
    "losing_trades": 2,
    "max_drawdown": 5.2,
    "consecutive_losses": 0,
    "last_trade_time": "2026-04-07T14:00:00.000Z",
    "cooldown_until": null,
    "created_at": "2026-04-01T00:00:00.000Z",
    "updated_at": "2026-04-07T14:00:00.000Z"
  }
}
```

#### POST /api/accounts/reset/:symbol

Reset account to starting balance (100U).

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "symbol": "BTC",
    "starting_balance": 100,
    "current_balance": 100,
    "equity": 100,
    "unrealized_pnl": 0,
    "realized_pnl": 0,
    "total_trades": 0,
    "winning_trades": 0,
    "losing_trades": 0,
    "max_drawdown": 0,
    "consecutive_losses": 0,
    "last_trade_time": null,
    "cooldown_until": null,
    ...
  },
  "message": "Account reset successfully"
}
```

### Performance

#### GET /api/performance?symbol=

Get performance metrics for an account.

**Query Parameters:**
- `symbol` (required): Symbol (BTC or ETH)
- `method` (optional): Filter by trading method (ict, kim_nghia) - defaults to ict

**Response Example:**
```json
{
  "success": true,
  "data": {
    "starting_balance": 100,
    "current_equity": 105.5,
    "current_balance": 100,
    "unrealized_pnl": 5.5,
    "realized_pnl": 5.5,
    "total_return_percent": 5.5,
    "win_rate": 60,
    "profit_factor": 2.5,
    "max_drawdown": 3.2,
    "average_r_multiple": 1.8,
    "total_trades": 10,
    "winning_trades": 6,
    "losing_trades": 4,
    "consecutive_losses": 0
  },
  "meta": {
    "symbol": "BTC",
    "account_id": 1
  }
}
```

#### GET /api/performance/equity-curve?symbol=&hours=

Get equity curve data for charting.

**Query Parameters:**
- `symbol` (required): Symbol (BTC or ETH)
- `hours` (optional): Hours of data to fetch (default: 168 = 7 days)

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "account_id": 1,
      "balance": 100,
      "equity": 100,
      "unrealized_pnl": 0,
      "open_positions": 0,
      "timestamp": "2026-04-07T00:00:00.000Z"
    },
    {
      "id": 2,
      "account_id": 1,
      "balance": 100,
      "equity": 102.5,
      "unrealized_pnl": 2.5,
      "open_positions": 1,
      "timestamp": "2026-04-07T00:05:00.000Z"
    }
  ],
  "meta": {
    "symbol": "BTC",
    "hours": 168,
    "count": 201
  }
}
```

#### GET /api/performance/trades?symbol=&limit=

Get trade history.

**Query Parameters:**
- `symbol` (optional): Filter by symbol
- `limit` (optional): Number of trades to return (default: 50)

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "position_id": "uuid-here",
      "symbol": "BTC",
      "side": "long",
      "entry_price": 67000,
      "stop_loss": 66500,
      "take_profit": 68000,
      "entry_time": "2026-04-07T12:00:00.000Z",
      "status": "taken_profit",
      "size_usd": 134,
      "size_qty": 0.002,
      "risk_usd": 1,
      "risk_percent": 1,
      "expected_rr": 2.0,
      "realized_pnl": 10,
      "unrealized_pnl": 0,
      "close_price": 68000,
      "close_time": "2026-04-07T14:00:00.000Z",
      "close_reason": "take_profit"
    }
  ],
  "meta": {
    "count": 1,
    "symbol": "BTC"
  }
}
```

### Pending Orders

#### GET /api/pending-orders

Get all pending orders (limit orders waiting for execution).

**Query Parameters:**
- `symbol` (optional): Filter by symbol (e.g., BTC, ETH)
- `status` (optional): Filter by status (pending, executed, cancelled)

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "order_id": "uuid-here",
      "account_id": 1,
      "symbol": "BTC",
      "side": "short",
      "entry_price": 67000,
      "current_price": 71000,
      "stop_loss": 72300,
      "take_profit": 64300,
      "size_usd": 147,
      "size_qty": 0.0022,
      "risk_usd": 1,
      "risk_percent": 1,
      "expected_rr": 2.0,
      "status": "pending",
      "created_at": "2026-04-07T12:00:00.000Z",
      "executed_at": null,
      "linked_prediction_id": 123,
      "invalidation_level": 72300
    }
  ],
  "meta": {
    "count": 1,
    "filters": { "symbol": "BTC", "status": "pending" }
  }
}
```

#### GET /api/pending-orders/:id

Get a specific pending order by ID.

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "order_id": "uuid-here",
    "symbol": "BTC",
    "side": "short",
    "entry_price": 67000,
    "stop_loss": 72300,
    "take_profit": 64300,
    "status": "pending",
    "created_at": "2026-04-07T12:00:00.000Z"
  }
}
```

#### POST /api/pending-orders

Create a new pending order (limit order).

**Request Body:**
```json
{
  "symbol": "BTC",
  "side": "short",
  "entry_price": 67000,
  "stop_loss": 72300,
  "take_profit": 64300
}
```

**Validation Rules:**
- Entry price must align with existing open positions to avoid executing in invalid price zones
- **SHORT orders**: Entry must be >= SL OR <= TP (cannot be between TP and SL)
- **LONG orders**: Entry must be >= TP OR <= SL (cannot be between SL and TP)
- Mixed side positions (short vs long) do not conflict
- Orders with same side are validated against each other

**Response Example:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "order_id": "uuid-here",
    "symbol": "BTC",
    "side": "short",
    "entry_price": 67000,
    "status": "pending"
  },
  "message": "Pending order created successfully"
}
```

**Error Response (400) - Invalid Entry Alignment:**
```json
{
  "success": false,
  "error": "Invalid entry alignment: SHORT entry 67000.00 is between TP 66500.00 and SL 68000.00 of existing position pos1. Entry must be >= SL or <= TP to avoid executing in invalid zone."
}
```

#### POST /api/pending-orders/:id/cancel

Cancel a pending order.

**Request Body:**
```json
{
  "reason": "manual"
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Pending order cancelled successfully"
}
```

### Analysis

#### POST /api/analysis/run

Manually trigger ICT analysis (bypasses 15-minute scheduler).

**Response Example:**
```json
{
  "success": true,
  "data": {
    "prices": {
      "btc": { "price": 67000, ... },
      "eth": { "price": 2050, ... },
      "timestamp": "2026-04-07T12:00:00.000Z"
    },
    "analysis": {
      "btc": {
        "bias": "bullish",
        "action": "buy",
        "confidence": 0.85,
        ...
      },
      "eth": { ... }
    },
    "lastUpdated": "2026-04-07T12:00:00.000Z"
  },
  "message": "Analysis completed successfully"
}
```

## Error Codes

- `200`: Success
- `400`: Bad Request (missing/invalid parameters)
- `404`: Not Found (resource doesn't exist)
- `503`: Service Unavailable (database not available)
- `500`: Internal Server Error

## Rate Limits

Currently no rate limits implemented. Use responsibly.

## Notes

- All prices are in USD
- All timestamps are in ISO 8601 format
- Position IDs are UUIDs
- Account balances are in USDT
- Paper trading only - no real money involved
