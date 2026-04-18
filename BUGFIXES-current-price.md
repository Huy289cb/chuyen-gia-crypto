# Bug Fixes: Paper Trading Logic Errors

## Date: 2026-04-18

### Problem
Multiple logic errors in paper trading system causing invalid positions and inconsistent behavior.

### Root Causes Found & Fixed

#### 1. Pending order execution fails after server restart
**File**: `backend/src/schedulers/priceUpdateScheduler.js` (lines 220-230)
- **Issue**: Logic checked `previousPrice !== null` before executing pending orders. After server restart, `previousPrice` is null, so orders wouldn't execute even if price was at entry level
- **Fix**: Changed to execute if current price is at/beyond entry level regardless of previous price. Now executes orders immediately if price condition is met, even on first run after restart

#### 2. Manual position opening inconsistent with auto-entry limit
**File**: `backend/src/routes/positions.js` (lines 116-121)
- **Issue**: Manual opening rejected if ANY position existed (`openPositions.length > 0`), but auto-entry allows up to 8 positions (`AUTO_ENTRY_CONFIG.maxPositionsPerSymbol = 8`)
- **Fix**: Changed to respect `maxPositionsPerSymbol` limit by importing `AUTO_ENTRY_CONFIG` and checking `openPositions.length >= AUTO_ENTRY_CONFIG.maxPositionsPerSymbol`

#### 3. Manual position opening missing minimum risk distance validation
**File**: `backend/src/routes/positions.js` (lines 124-146)
- **Issue**: Manual opening calculated position size with 1% risk but didn't validate minimum risk distance (0.5% of entry price) like auto-entry does. Could create positions with unrealistically tight stop losses
- **Fix**: Added validation for minimum risk distance (0.5% of entry price) with appropriate error messages

#### 4. Tight stop loss validation in auto-entry logic
**File**: `backend/src/services/autoEntryLogic.js` (lines 265-274)
- **Issue**: AI could suggest stop loss too close to entry (e.g., entry $76,148.72, SL $76,149.99 - only $1.27 difference), causing guaranteed losses
- **Fix**: Added validation to ensure risk distance is at least 0.5% of entry price before creating position

#### 5. Tight stop loss validation in Groq analyzer
**File**: `backend/src/groqAnalyzer.js` (lines 479-487, 529)
- **Issue**: AI validation only checked if SL/TP was within 50%-150% of current price, but didn't validate minimum distance from entry
- **Fix**: Added validation in `validatePriceLevel` to ensure stop loss is at least 0.5% away from suggested entry price

---

## Date: 2026-04-16

### Problem
Open Positions section not displaying current price properly.

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

#### 6. TP1 hit handler not updating `current_price` or `unrealized_pnl`
**File**: `backend/src/services/paperTradingEngine.js` (lines 294-305)
- **Issue**: When position hits TP1 (trailing stop), only updated `stop_loss` and `tp1_hit`
- **Fix**: Now also calculates and updates `unrealized_pnl` and `current_price`

#### 7. Pending order execution not setting `current_price`
**File**: `backend/src/schedulers/priceUpdateScheduler.js` (lines 213-226)
- **Issue**: positionData when executing pending order didn't include `current_price`
- **Fix**: Added `current_price: currentPrice` to positionData

#### 8. **CRITICAL**: Migration 6 never runs if prediction columns already exist
**File**: `backend/src/db/migrations.js` (lines 209-211)
- **Issue**: If all prediction columns exist, migration called `createIndexes` directly without running migration 6
- **Fix**: Changed to always call `runMigration6` regardless of prediction migrations

#### 9. `CREATE TABLE positions` missing `current_price` column
**File**: `backend/src/db/migrations.js` (line 47)
- **Issue**: New databases created without `current_price` in schema
- **Fix**: Added `current_price REAL DEFAULT 0` to CREATE TABLE

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
