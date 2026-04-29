# Binance Futures Integration (REST API)

## Overview

This project integrates Binance USD-M Futures using the official REST API, with support for:

- Demo trading via `https://demo-fapi.binance.com`
- Mainnet via `https://fapi.binance.com`
- BTC-only execution for the active Kim Nghia method
- Running in parallel with paper trading for comparison

The implementation does not use a Binance SDK. All requests go through the local REST modules in `backend/src/services/binance/`.

## Current Behavior

### Order placement

- Market entry orders use `POST /fapi/v1/order` with `type=MARKET`
- Hedge-mode stop loss uses `POST /fapi/v1/order` with:
  - `type=STOP_MARKET`
  - `positionSide=LONG|SHORT`
  - `closePosition=true`
- Hedge-mode take profit uses `POST /fapi/v1/order` with:
  - `type=TAKE_PROFIT_MARKET`
  - `positionSide=LONG|SHORT`
  - `closePosition=true`

The system no longer relies on non-standard paths such as `/fapi/v1/order/stopMarket` or `/fapi/v1/order/takeProfitMarket`.

### Retry policy

The Binance HTTP client classifies errors into retriable and non-retriable groups.

Non-retriable examples:
- `-5000` invalid request contract/path
- `-2015` invalid API key or permissions
- `-2022` reduce-only rejected
- `-4046` margin type already set
- `-4059` position mode already set

Retriable examples:
- `-1008` rate limit
- `-1021` timestamp drift
- network no-response failures

### Entry protection recovery

If a market entry is filled on Binance but SL/TP placement fails immediately after:

- the engine places a recovery market close
- it records `entry_protection_failed`
- it records `recovery_close`
- it does not save the position in `testnet_positions`

This prevents orphan live positions on Binance that are missing from the local database.

### Balance and equity sync

Account sync now uses:

- `walletBalance` as the source of truth for `current_balance`
- `walletBalance + totalUnrealizedProfit` as the source of truth for `equity`

`availableBalance` is not used for realized balance sync because it drops when margin is reserved or orders are open.

### Volume constraints

The system enforces volume limits to manage risk:

- Total volume (open positions + pending orders) is limited to 2k per account
- Volume is capped when adding new orders would exceed the limit
- Risk is recalculated based on capped volume
- Entry alignment validation prevents limit orders from executing in invalid price zones:
  - LONG positions: Entry must be ≥ TP OR ≤ SL (cannot be between SL and TP)
  - SHORT positions: Entry must be ≥ SL OR ≤ TP (cannot be between TP and SL)

Helper functions in `testnetEngine.js`:
- `calculateTestnetTotalVolume()` - Calculates total volume from open positions + pending orders
- `validateTestnetEntryAlignment()` - Validates entry price alignment with existing positions

## Main Components

### REST modules

Path: `backend/src/services/binance/`

- `config.js`: base URL, API key, recvWindow, symbol, leverage
- `client.js`: signed HTTP requests and retry policy
- `market.js`: server time and market data
- `account.js`: balances and positions
- `trading.js`: leverage, margin type, position mode, order placement, cancellations

### Wrapper service

Path: `backend/src/services/binanceClient.js`

This layer adapts the low-level REST modules into application-facing helpers such as:

- `placeMarketOrder()`
- `placeStopLossOrder()`
- `placeTakeProfitOrder()`
- `getAccountBalance()`

### Testnet engine

Path: `backend/src/services/testnetEngine.js`

Responsibilities:

- open and close Binance testnet positions
- place and track SL/TP
- recover from entry-protection failures
- sync DB state with Binance state
- detect and close orphan Binance positions
- create account snapshots

### Testnet database

Path: `backend/src/db/testnetDatabase.js`

Primary tables:

- `testnet_accounts`
- `testnet_positions`
- `testnet_trade_events`
- `testnet_account_snapshots`
- `testnet_pending_orders`

Relevant `testnet_positions` fields include:

- `binance_order_id`
- `binance_sl_order_id`
- `binance_tp_order_id`
- `tp_levels`
- `tp_hit_count`
- `partial_closed`

## Environment Variables

Add these to `backend/.env`:

```bash
BINANCE_ENABLED=true
BINANCE_BASE_URL=https://demo-fapi.binance.com
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_secret_key
BINANCE_SYMBOL=BTCUSDT
BINANCE_LEVERAGE=20
BINANCE_RECV_WINDOW=5000
```

To switch to mainnet:

```bash
BINANCE_BASE_URL=https://fapi.binance.com
```

## API Endpoints

### GET `/api/testnet/sync/:accountId`

Runs a manual account sync.

Current response shape:

```json
{
  "success": true,
  "message": "Testnet account synced successfully",
  "data": {
    "balance": 1000,
    "equity": 1050,
    "unrealized_pnl": 50,
    "synced_at": "2026-04-29T12:00:00.000Z"
  }
}
```

### POST `/api/testnet/cleanup/:accountId`

Runs a one-time cleanup flow:

- cancel open Binance orders not tracked in DB
- detect and close orphan Binance positions
- re-sync account balances and snapshots

## CLI Cleanup

You can run the same cleanup flow from the backend directory:

```bash
npm run testnet:cleanup
```

This is intended as an operational recovery tool after:

- bad deploys
- partial order failures
- manual Binance-side intervention
- lingering orphan orders or positions

## Troubleshooting

### Error: invalid stopMarket path

If you see:

```text
Binance API Error -5000: Path /fapi/v1/order/stopMarket, Method POST is invalid
```

The deployment is still running old code. Pull the latest backend and restart PM2.

### Repeated balance discrepancy warnings

If you see:

```text
[TestnetEngine] Balance discrepancy detected for account X
```

Check:

1. whether the warning appears after a real cleanup/restart event
2. whether there were external manual trades on Binance
3. whether orphan orders/positions exist
4. whether `npm run testnet:cleanup` clears the drift

### Cleanup script fails to initialize engine

If `npm run testnet:cleanup` fails before connecting to Binance:

1. confirm `BINANCE_ENABLED=true`
2. confirm `BINANCE_API_KEY` and `BINANCE_API_SECRET` are present in `backend/.env`
3. confirm the key has Futures permission
4. confirm the base URL matches Demo or Mainnet as intended

## Regression Test Command

```bash
npm run test:run -- tests/unit/binanceHttpClient.test.js tests/unit/binanceTrading.test.js tests/unit/binanceClient.test.js tests/unit/testnetDatabase.test.js tests/unit/testnetEngine.test.js tests/integration/testnetFlow.test.js
```

## References

- [Binance USD-M Futures New Order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order)
- [Binance Futures Testnet](https://testnet.binancefuture.com/)
- [Binance Mainnet Futures](https://www.binance.com/en/futures)
