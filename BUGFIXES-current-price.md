# Bug Fixes: current_price in Open Positions

## Date: 2026-04-16

### Problem
Open Positions section not displaying current price properly.

### Root Causes Found & Fixed

#### 1. Missing `current_price` column in database
**File**: `backend/src/db/migrations.js`
- **Issue**: positions table didn't have `current_price` column
- **Fix**: Added Migration 6 to add `current_price REAL DEFAULT 0` column

#### 2. `createPosition` not saving `current_price`
**File**: `backend/src/db/database.js` (lines 941-978)
- **Issue**: INSERT statement didn't include `current_price` column
- **Fix**: Added `current_price` to destructuring, INSERT columns, and VALUES (with fallback to entry_price)

#### 3. `updatePosition` not handling `current_price` updates
**File**: `backend/src/db/database.js` (lines 1069-1076)
- **Issue**: UPDATE function didn't have handler for `current_price` field
- **Fix**: Added handler for `updates.current_price` to update the column

#### 4. `updatePositionPnL` not updating `current_price`
**File**: `backend/src/services/paperTradingEngine.js` (lines 144-157)
- **Issue**: Only updated `unrealized_pnl`, not `current_price`
- **Fix**: Now updates both `unrealized_pnl` and `current_price`

#### 5. `openPosition` not setting initial `current_price`
**File**: `backend/src/services/paperTradingEngine.js` (lines 32-47)
- **Issue**: positionData didn't include `current_price`
- **Fix**: Added `current_price: suggestion.entry_price` when opening position

### Data Flow After Fix

```
PriceScheduler (30s)
    ↓
fetchCurrentPrices() → Gets BTC/ETH prices
    ↓
updateSymbolPositions(symbol, currentPrice)
    ↓
updateOpenPositions() → For each open position
    ↓
updatePositionPnL(position, currentPrice)
    ↓
updatePosition(db, id, {
    unrealized_pnl: pnl,
    current_price: currentPrice  ✅ FIXED
})
    ↓
Frontend ← API /positions ← Database
```

### Deployment Required
- Backend needs redeployment for:
  - Migration 6 to run (adds current_price column)
  - New code to take effect

### Testing Checklist
- [ ] Open positions show correct current price
- [ ] Current price updates every 30 seconds
- [ ] PnL calculation uses current price correctly
- [ ] After closing position, close_price is saved correctly
