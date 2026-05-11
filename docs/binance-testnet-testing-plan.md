# Binance Futures Testnet Integration Testing Plan

## Overview

This document outlines the testing plan for the Binance Futures Testnet integration implemented according to `docs/feedback/fb.md`.

## Test Environment Setup

1. Set `BINANCE_ENABLED=true` in `.env`
2. Configure Binance testnet API credentials:
   - `BINANCE_API_KEY`
   - `BINANCE_API_SECRET`
   - `BINANCE_TESTNET_WS_URL` (default: `wss://stream.binancefuture.com/ws`)
3. Ensure backend is running with testnet configuration
4. Verify Binance testnet account has sufficient balance

## Phase 1: Real Binance Order Placement Tests

### Test 1.1: Order Placement Verification
**Objective**: Verify orders appear on Binance testnet

**Steps**:
1. Trigger Kim Nghia analysis with high confidence (>82%)
2. Wait for pending order creation
3. Check Binance testnet UI/API for the order
4. Verify `binanceOrderId` is saved in local DB

**Expected Result**:
- Order appears in Binance testnet open orders
- Local DB has `binanceOrderId` field populated
- Order details match (symbol, side, price, quantity)

**Test 1.2: Local Execution Disabled**
**Objective**: Verify local candle-based execution is disabled

**Steps**:
1. Set `BINANCE_ENABLED=true`
2. Monitor `testnet-sync.ts` logs
3. Trigger price updates that would normally execute pending orders

**Expected Result**:
- `syncTestnetForSymbol` returns early
- No local execution occurs
- Logs show "BINANCE_ENABLED is true, skipping local execution"

## Phase 2: WebSocket Synchronization Tests

### Test 2.1: WebSocket Connection
**Objective**: Verify WebSocket connects successfully

**Steps**:
1. Start backend with `BINANCE_ENABLED=true`
2. Check startup logs for WebSocket connection
3. Verify listen key creation

**Expected Result**:
- Logs show "WebSocket connected"
- Listen key created successfully
- Keep-alive interval started

### Test 2.2: ORDER_TRADE_UPDATE Event
**Objective**: Verify order updates sync correctly

**Steps**:
1. Create a pending order on Binance testnet
2. Cancel the order from Binance UI
3. Check local DB for status update

**Expected Result**:
- Local order status changes to `cancelled`
- Event logged in trade events
- Logs show ORDER_TRADE_UPDATE handled

### Test 2.3: ACCOUNT_UPDATE Event
**Objective**: Verify account updates are received

**Steps**:
1. Monitor WebSocket logs
2. Perform account action on Binance (e.g., adjust margin)
3. Check for ACCOUNT_UPDATE event

**Expected Result**:
- ACCOUNT_UPDATE event logged
- Account balance can be synced if needed

### Test 2.4: Partial Fill Support
**Objective**: Verify partial fills are handled

**Steps**:
1. Place a large order that may partially fill
2. Monitor for PARTIALLY_FILLED status
3. Check local DB for partial fill tracking

**Expected Result**:
- Partial fill status recorded
- Executed quantity tracked
- Average price calculated

## Phase 3: Position Creation Tests

### Test 3.1: Position Creation After Fill
**Objective**: Verify positions are created only after Binance confirms fill

**Steps**:
1. Create pending order via API
2. Wait for order to fill on Binance
3. Check local DB for position creation

**Expected Result**:
- Position created in local DB only after FILLED event
- Position has correct `binanceOrderId`
- Entry price matches Binance fill price

### Test 3.2: Position Details Accuracy
**Objective**: Verify position details match Binance

**Steps**:
1. After position creation, compare local vs Binance
2. Check: entry price, quantity, side, symbol

**Expected Result**:
- All details match Binance
- No discrepancy in position data

## Phase 4: SL/TP Order Tests

### Test 4.1: SL Order Placement
**Objective**: Verify stop loss orders are placed on Binance

**Steps**:
1. Create a position via filled order
2. Check Binance for STOP_MARKET order
3. Verify `reduceOnly: true` and correct `positionSide`

**Expected Result**:
- STOP_MARKET order appears on Binance
- Order has `reduceOnly: true`
- Correct `positionSide` set (LONG/SHORT)
- Local position tracks `binanceSlOrderId`

### Test 4.2: TP Order Placement
**Objective**: Verify take profit orders are placed on Binance

**Steps**:
1. Create a position via filled order
2. Check Binance for TAKE_PROFIT_MARKET order
3. Verify `reduceOnly: true` and correct `positionSide`

**Expected Result**:
- TAKE_PROFIT_MARKET order appears on Binance
- Order has `reduceOnly: true`
- Correct `positionSide` set (LONG/SHORT)
- Local position tracks `binanceTpOrderId`

### Test 4.3: ReduceOnly Behavior
**Objective**: Verify SL/TP orders don't open reverse positions

**Steps**:
1. Place SL/TP orders
2. Manually trigger SL on Binance
3. Check that position is closed, not reversed

**Expected Result**:
- Position closes when SL triggered
- No new position opened
- Account balance updated correctly

## Phase 5: Cancellation Tests

### Test 5.1: Order Cancellation
**Objective**: Verify Binance-first cancellation works

**Steps**:
1. Create pending order
2. Cancel via API endpoint
3. Check Binance for cancellation
4. Check local DB for status update

**Expected Result**:
- Binance order cancelled first
- Local DB updated only after Binance success
- Error returned if Binance cancellation fails

### Test 5.2: Cleanup Endpoint
**Objective**: Verify bulk cancellation works

**Steps**:
1. Create multiple pending orders
2. Call cleanup endpoint
3. Check Binance for all cancellations
4. Check local DB

**Expected Result**:
- All Binance orders cancelled
- Local DB updated for all orders
- Errors reported if any cancellations fail

### Test 5.3: Cancellation Error Handling
**Objective**: Verify errors are not silently swallowed

**Steps**:
1. Create pending order
2. Manually cancel on Binance (simulate already cancelled)
3. Try to cancel via API

**Expected Result**:
- Explicit error returned
- No silent fallback
- Error message includes Binance error details

## Phase 6: WebSocket Reliability Tests

### Test 6.1: Reconnect Handling
**Objective**: Verify WebSocket reconnects after disconnection

**Steps**:
1. Start backend
2. Manually kill WebSocket connection
3. Wait for reconnection attempt

**Expected Result**:
- WebSocket automatically reconnects
- Listen key recreated if needed
- Logs show reconnection attempts

### Test 6.2: Periodic Polling
**Objective**: Verify periodic reconciliation runs

**Steps**:
1. Start backend
2. Wait 60+ seconds
3. Check logs for periodic reconciliation

**Expected Result**:
- Periodic reconciliation runs every 60 seconds
- Local state compared with Binance
- Inconsistencies logged

## Phase 7: Idempotency Tests

### Test 7.1: Duplicate Order Prevention
**Objective**: Verify newClientOrderId prevents duplicates

**Steps**:
1. Create pending order (generates newClientOrderId)
2. Simulate retry with same clientOrderId
3. Check for duplicate order error

**Expected Result**:
- Second request fails with "Duplicate order" error
- Only one order created on Binance
- Error logged appropriately

### Test 7.2: Retry Safety
**Objective**: Verify retry doesn't create duplicates

**Steps**:
1. Trigger order placement with network delay
2. Allow retry to occur
3. Check Binance for order count

**Expected Result**:
- Only one order on Binance
- ClientOrderId uniqueness enforced

## Phase 8: Hedge Mode Tests

### Test 8.1: Mode Detection
**Objective**: Verify hedge mode is detected on startup

**Steps**:
1. Start backend
2. Check logs for mode detection
3. Verify detected mode matches Binance account

**Expected Result**:
- Mode detected correctly (ONE_WAY or HEDGE)
- Logs show detected mode
- Detection occurs within 3 seconds of startup

### Test 8.2: PositionSide Compatibility
**Objective**: Verify correct positionSide values used

**Steps**:
1. Create order with HEDGE mode account
2. Verify positionSide = LONG/SHORT
3. Create order with ONE_WAY mode account
4. Verify positionSide = null

**Expected Result**:
- HEDGE mode: positionSide sent
- ONE_WAY mode: positionSide not sent
- Orders accepted by Binance

### Test 8.3: Mode Validation
**Objective**: Verify mode compatibility warnings

**Steps**:
1. Try to use hedge features with ONE_WAY account
2. Check for validation warnings

**Expected Result**:
- Warning logged if mode mismatch
- System defaults to compatible behavior

## Phase 9: Error Handling Tests

### Test 9.1: No Silent Fallback
**Objective**: Verify errors are explicit

**Steps**:
1. Disable Binance API credentials
2. Try to create order
3. Check error response

**Expected Result**:
- Explicit error returned
- No silent fallback to paper trading
- Error message includes Binance error details

### Test 9.2: Client Unavailable
**Objective**: Verify client unavailability is handled

**Steps**:
1. Set BINANCE_ENABLED=true but invalid credentials
2. Try to create order
3. Check response

**Expected Result**:
- 503 error returned
- Error message: "Binance client unavailable"
- No order created locally

## Phase 10: Restart Recovery Tests

### Test 10.1: Startup Reconciliation
**Objective**: Verify state sync on restart

**Steps**:
1. Create open orders and positions
2. Restart backend
3. Check reconciliation logs
4. Verify local state matches Binance

**Expected Result**:
- Startup reconciliation runs within 5 seconds
- Open orders compared and synced
- Positions compared and synced
- Inconsistencies reported

### Test 10.2: Missed WebSocket Events
**Objective**: Verify recovery from missed events

**Steps**:
1. Create order while backend is down
2. Start backend
3. Check if order is detected

**Expected Result**:
- Startup reconciliation detects orphaned orders
- Appropriate action taken (mark as failed/warn)

## Test Execution Checklist

- [ ] All Phase 1 tests passed
- [ ] All Phase 2 tests passed
- [ ] All Phase 3 tests passed
- [ ] All Phase 4 tests passed
- [ ] All Phase 5 tests passed
- [ ] All Phase 6 tests passed
- [ ] All Phase 7 tests passed
- [ ] All Phase 8 tests passed
- [ ] All Phase 9 tests passed
- [ ] All Phase 10 tests passed

## Known Limitations

1. **Position SL/TP Update**: The WebSocket sync handles algo order fills but doesn't yet update local positions when SL/TP triggers. This should be implemented in a future iteration.

2. **ClientOrderId Query**: When duplicate order error occurs, we don't yet query Binance for the existing order by clientOrderId. This could be added for better error recovery.

3. **Orphaned Position Handling**: Orphaned positions (on Binance but not local) are only logged, not automatically recreated. This could be implemented for full automation.

## Success Criteria

The implementation is considered successful when:
- Orders appear on Binance testnet
- Fills synchronize correctly
- Local DB mirrors Binance state
- SL/TP managed on Binance
- No duplicate executions
- Restart-safe architecture
- Production-ready foundation for real trading
