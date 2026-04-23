# AI Position Management

## Overview

The AI position management system enables the AI to actively manage open positions and pending orders with specific actions based on market analysis. This enhancement allows for more dynamic and intelligent trading decisions.

## BTC-Only Mode

**Current Status:** The system is operating in BTC-only mode. ETH analysis has been temporarily paused to focus on refining the AI position management capabilities for BTC before expanding to other assets.

## AI Response Structure

The AI now returns decision arrays for positions and pending orders:

```json
{
  "btc": {
    "bias": "bullish|bearish|neutral",
    "action": "buy|sell|hold",
    "confidence": 0.00-1.00,
    "narrative": "...",
    "suggested_entry": number,
    "suggested_stop_loss": number,
    "suggested_take_profit": number,
    "expected_rr": number,
    "position_decisions": [
      {
        "position_id": "string",
        "action": "hold|close_early|close_partial|move_sl|reverse",
        "confidence": 0.00-1.00,
        "reason": "string",
        "new_sl": number (optional, for move_sl),
        "new_tp": number (optional, for move_sl/close_partial),
        "close_percent": number (optional, for close_partial, 0-1)
      }
    ],
    "pending_order_decisions": [
      {
        "order_id": "string",
        "action": "hold|cancel|modify",
        "confidence": 0.00-1.00,
        "reason": "string",
        "new_entry": number (optional, for modify),
        "new_sl": number (optional, for modify),
        "new_tp": number (optional, for modify)
      }
    ]
  }
}
```

## Action Definitions

### Position Actions

- **hold**: Giữ nguyên position - No action taken
- **close_early**: Đóng position sớm (full close) - Closes the entire position immediately
- **close_partial**: Chốt một phần position - Closes a percentage of the position (specify close_percent)
- **move_sl**: Dịch chuyển stop loss - Updates the stop loss level (specify new_sl, optionally new_tp)
- **reverse**: Đảo chiều position - Closes current position and opens a new opposite position

### Pending Order Actions

- **hold**: Giữ nguyên pending order - No action taken
- **cancel**: Hủy pending order - Cancels the pending limit order
- **modify**: Sửa pending order - Modifies entry, SL, or TP of the pending order

## Confidence Thresholds

Actions are only executed if the AI's confidence meets or exceeds the method-specific threshold:

- **ICT Method**: 70% confidence threshold
- **Kim Nghia Method**: 75% confidence threshold

If confidence is below the threshold, the action defaults to `hold`.

## Implementation Details

### Enhanced Prompt Context

The AI now receives enhanced context for decision making:

- **60 most recent 15m candles** for BTC (reduced from unlimited to focus on recent price action)
- **Open positions** with detailed info:
  - Position ID
  - Entry price, current price, SL, TP
  - Unrealized PnL and PnL percentage
  - Risk percentage
  - Time in position
- **Pending orders** with detailed info:
  - Order ID
  - Entry price, current price
  - Price distance percentage
  - Time waiting
  - Risk percentage and R:R ratio

### New Functions

#### Paper Trading Engine (`paperTradingEngine.js`)

- `closePartialPosition(db, position, closePercent, currentPrice, reason)` - Closes a percentage of a position
- `updateStopLoss(db, position, newSl, reason)` - Updates stop loss for a position
- `reversePosition(db, position, currentPrice, suggestion, reason)` - Reverses a position

#### Database (`database.js`)

- `updatePendingOrder(db, orderId, updates)` - Updates pending order fields
- `modifyPendingOrder(db, order, newEntry, newSl, newTp)` - Modifies pending order with validation

#### Scheduler (`scheduler.js`)

- Processes `position_decisions` array with confidence threshold checking
- Processes `pending_order_decisions` array with confidence threshold checking
- Executes actions based on validated decisions

### Validation

The system validates all AI decisions before execution:

- **Required fields**: position_id/order_id, action, confidence, reason
- **Action values**: Must be in allowed list
- **Confidence range**: Must be between 0-1
- **Optional fields**: Validated based on action type (e.g., close_percent for close_partial, new_sl for move_sl)

## Example Scenarios

### Scenario 1: Partial Take Profit

AI detects price approaching resistance and recommends taking partial profit:

```json
{
  "position_id": "pos_123",
  "action": "close_partial",
  "confidence": 0.85,
  "reason": "Price approaching key resistance level, securing partial profits",
  "close_percent": 0.5
}
```

### Scenario 2: Trailing Stop Loss

AI recommends moving stop loss to breakeven after price moved favorably:

```json
{
  "position_id": "pos_123",
  "action": "move_sl",
  "confidence": 0.78,
  "reason": "Price moved 1:1 R:R, moving SL to breakeven to protect capital",
  "new_sl": 95000
}
```

### Scenario 3: Position Reversal

AI detects trend reversal and recommends flipping position:

```json
{
  "position_id": "pos_123",
  "action": "reverse",
  "confidence": 0.82,
  "reason": "Market structure shifted from bullish to bearish, reversing position",
  "new_sl": 94000,
  "new_tp": 92000
}
```

### Scenario 4: Cancel Pending Order

AI recommends canceling a limit order that's no longer valid:

```json
{
  "order_id": "ord_456",
  "action": "cancel",
  "confidence": 0.80,
  "reason": "Market conditions changed, setup no longer valid"
}
```

## Testing Checklist

- [x] AI returns valid position_decisions array
- [x] AI returns valid pending_order_decisions array
- [x] Confidence threshold filtering works correctly
- [x] `close_partial` reduces position size correctly
- [x] `move_sl` updates stop loss in database
- [x] `reverse` closes old position and opens new opposite
- [x] `modify` updates pending order correctly
- [x] Invalid actions are rejected (confidence < threshold)
- [x] Missing required fields are handled gracefully
- [x] Documentation is complete and accurate

## Future Enhancements

- Re-enable ETH analysis once BTC position management is stable
- Add more granular position management actions (e.g., scale in/out)
- Implement AI-driven position sizing adjustments
- Add portfolio-level risk management decisions
- Support for multi-asset position hedging strategies
