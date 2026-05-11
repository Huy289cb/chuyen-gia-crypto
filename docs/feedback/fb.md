# Fix Testnet Order Placement - Proper Binance Futures Integration

## Overview

The current testnet implementation is performing local paper trading instead of placing actual orders on Binance Futures Testnet.

Orders are:
- created locally in the database
- simulated using candle-based execution logic
- never submitted to Binance

As a result:
- no orders appear in Binance testnet account
- local state diverges from real exchange state
- SL/TP and fills are not synchronized

---

# Root Cause

Current architecture:

Signal
  ↓
Create local pending order
  ↓
Local candle trigger
  ↓
Create local position

Problems:
- Binance API client exists but is unused
- local simulation acts as execution engine
- no real exchange synchronization
- no order lifecycle handling
- no partial fill support

Affected files:
- `backend/src/services/kim-nghia-analysis-job.ts`
- `backend/src/services/testnet-sync.ts`

---

# Target Architecture

Binance Futures must become the single source of truth.

Correct architecture:

Signal Engine
    ↓
Order Service
    ↓
Place Binance LIMIT order
    ↓
Save local order + binanceOrderId
    ↓
Binance User Data Stream / Sync
    ↓
Receive ORDER_TRADE_UPDATE
    ↓
Update local order state
    ↓
If FILLED:
    create/update local position
    place SL/TP orders

Important:
- local candle execution must be disabled when Binance integration is enabled
- local DB mirrors Binance state
- execution decisions come from Binance only

---

# Required Changes

---

# Phase 1 — Place Real Binance Orders

## File
`backend/src/services/kim-nghia-analysis-job.ts`

## Goals

When creating pending orders:
- place actual LIMIT order on Binance Futures Testnet
- save Binance order ID locally
- stop relying on local simulated execution

## Required Changes

### 1. Import Binance client

```ts
import {
  initTestnetClient,
  placeLimitOrder,
} from '../services/binanceClient';
2. Place Binance order before local DB save

Example:

const client = initTestnetClient();

if (!client) {
  throw new Error('Binance client unavailable');
}

const binanceSide = side === 'long'
  ? 'BUY'
  : 'SELL';

const positionSide = side === 'long'
  ? 'LONG'
  : 'SHORT';

const order = await placeLimitOrder(
  client,
  'BTCUSDT',
  binanceSide,
  sizeQty,
  entry,
  positionSide,
);

const binanceOrderId = String(order.orderId);
3. Save Binance order ID
await createTestnetPendingOrder({
  ...
  binanceOrderId,
});
4. Disable local execution engine
File

backend/src/services/testnet-sync.ts

Current local candle-based execution must be disabled when:

BINANCE_ENABLED=true

Reason:

Binance becomes execution authority
local execution causes duplicate fills and state divergence

Example:

if (process.env.BINANCE_ENABLED === 'true') {
  return;
}
Phase 2 — Implement Binance Order Synchronization
Goal

Local database must synchronize from Binance order updates.

Do NOT:

create positions first locally
then ask Binance afterward

Correct flow:

Binance reports FILLED
↓
Create/update local position

Recommended Implementation

Use Binance Futures User Data Stream WebSocket.

Events:

ORDER_TRADE_UPDATE
ACCOUNT_UPDATE

Fallback:

periodic REST polling
Required Logic

Handle order statuses:

NEW
PARTIALLY_FILLED
FILLED
CANCELED
EXPIRED
REJECTED
Partial Fill Support

Must support:

partial quantity fills
average execution price
cumulative filled quantity

Otherwise:

local PnL becomes incorrect
SL/TP quantity becomes incorrect
Phase 3 — Position Creation From Binance Fills
Goal

Create local positions ONLY after Binance confirms fills.

Required Logic

When receiving:

ORDER_TRADE_UPDATE
status = FILLED

Then:

update local pending order
create/update local position
save:
executed quantity
average fill price
fees
timestamps
Phase 4 — SL / TP Order Placement
Goal

After entry order fills:

place real SL and TP orders on Binance
Required Order Types
Stop Loss
STOP_MARKET
Take Profit
TAKE_PROFIT_MARKET
Critical Requirements

Must include:

reduceOnly: true

Correct:

positionSide

Reason:

avoid unintentionally opening reverse positions
ensure orders only reduce existing positions
Save Binance IDs

Store:

binanceSlOrderId
binanceTpOrderId
Phase 5 — Cancellation & Recovery
Cancellation
File

backend/src/routes/testnet.ts

Improve:

logging
retry handling
Binance error visibility

When canceling:

cancel Binance order first
update local DB only after successful cancel
Startup Reconciliation

On backend startup:

fetch open Binance orders
fetch open Binance positions
compare against local DB
repair inconsistencies

Reason:

server crashes
restarts
network failures
missed WebSocket events
Phase 6 — WebSocket Reliability
Required Features
Reconnect handling

If WebSocket disconnects:

reconnect automatically
resume synchronization
Recovery polling

Periodic reconciliation:

every 30–60 seconds
verify local state matches Binance
Phase 7 — Idempotency Protection
Problem

Retries may create duplicate orders.

Example:

Request timeout
↓
Retry request
↓
Two Binance orders created

Solution

Use:

newClientOrderId

Requirements:

unique per signal/order
stored locally
retry-safe
Phase 8 — Hedge Mode Validation

Binance Futures supports:

One-way mode
Hedge mode

System must:

detect account mode on startup
validate compatibility
send correct positionSide

Example:

LONG
SHORT

Incorrect mode handling can cause:

rejected orders
incorrect position behavior
Phase 9 — Error Handling Rules
DO NOT silently fallback to paper trading

Incorrect:

catch (error) {
  console.error(error);
  continuePaperTrading();
}

Reason:
User may believe real orders were placed.

Correct Behavior

If Binance order placement fails:

mark order as FAILED
return explicit error
notify logs/UI

Optional:

explicit PAPER mode
explicit REAL mode

Never auto-switch silently.

Phase 10 — Testing Plan
Test Cases
Order Placement
verify order appears on Binance testnet
Fill Synchronization
verify local state updates after Binance fill
Partial Fill
verify quantities update correctly
Cancellation
verify both Binance and DB states update
SL/TP
verify reduceOnly behavior
Restart Recovery
restart backend during open orders
WebSocket Disconnect
simulate reconnect/recovery
Duplicate Prevention
retry requests safely
Implementation Priority
Priority 1
Real Binance order placement
Disable local execution
Priority 2
WebSocket synchronization
Fill lifecycle handling
Priority 3
SL/TP implementation
Priority 4
Recovery + reconciliation
Priority 5
Reliability + testing
Expected Final Result

After implementation:

orders appear in Binance Futures Testnet
fills synchronize correctly
local DB mirrors Binance state
SL/TP managed on Binance
no duplicate executions
restart-safe architecture
production-ready foundation for real trading