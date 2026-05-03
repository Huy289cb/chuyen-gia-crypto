# Crypto Bot Code Improvements Plan

This plan implements code-level fixes to resolve the 48h no-position issue, negative PnL problem, and testnet-papertrading discrepancies without requiring database reset.

## Overview

Implement targeted code fixes to:
1. Auto-cancel stale pending orders to unblock new positions
2. Improve SL/TP settings to reduce loss rate
3. Fix testnet equity calculation discrepancy
4. Add better pending order management
5. Implement volume limit separation

## Implementation Steps

### Step 1: Add Auto-Cancel Stale Pending Orders

**File:** `src/schedulers/priceUpdateScheduler.js`

Add function to cancel pending orders older than 24 hours:

```javascript
// Add after checkAndExecutePendingOrders function
async function cancelStalePendingOrders(symbol) {
  try {
    const { getPendingOrders, cancelPendingOrder } = await import('../db/database.js');
    const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    const pendingOrders = await getPendingOrders(db, { symbol, status: 'pending' });

    for (const order of pendingOrders) {
      const createdAt = new Date(order.created_at).getTime();
      if (now - createdAt > STALE_THRESHOLD) {
        console.log(`[PriceScheduler] Cancelling stale pending order ${order.id} (age: ${Math.floor((now - createdAt) / (60 * 60 * 1000))}h)`);
        await cancelPendingOrder(db, order.id, 'stale');
      }
    }
  } catch (error) {
    console.error(`[PriceScheduler] Error cancelling stale orders:`, error.message);
  }
}
```

Call this function in `updateSymbolPositions`:

```javascript
// Add after checkAndExecutePendingOrders call
await cancelStalePendingOrders(symbol);
```

**Testnet version:** Add similar function for testnet pending orders in same file:

```javascript
async function cancelStaleTestnetPendingOrders(symbol) {
  try {
    if (process.env.BINANCE_ENABLED !== 'true') return;

    const { getTestnetPendingOrders, cancelTestnetPendingOrder } = await import('../db/testnetDatabase.js');
    const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    const pendingOrders = await getTestnetPendingOrders(db, { symbol, status: 'pending' });

    for (const order of pendingOrders) {
      const createdAt = new Date(order.created_at).getTime();
      if (now - createdAt > STALE_THRESHOLD) {
        console.log(`[PriceScheduler] Cancelling stale testnet pending order ${order.order_id} (age: ${Math.floor((now - createdAt) / (60 * 60 * 1000))}h)`);
        await cancelTestnetPendingOrder(db, order.order_id, 'stale', order.binance_order_id);
      }
    }
  } catch (error) {
    console.error(`[PriceScheduler] Error cancelling stale testnet orders:`, error.message);
  }
}
```

Call in `updateTestnetPositions`:

```javascript
// Add after existing sync logic
await cancelStaleTestnetPendingOrders('BTC');
```

### Step 2: Improve SL/TP Settings for Kim Nghia Method

**File:** `src/config/methods.js`

Update Kim Nghia configuration:

```javascript
kim_nghia: {
  // ... existing config ...
  autoEntry: {
    minConfidence: 80, // Increase from 75 to 80
    minRRRatio: 3.0, // Increase from 2.5 to 3.0
    riskPerTrade: 0.08, // Reduce from 0.10 to 0.08 (8%)
    maxPositionsPerSymbol: 6,
    maxVolumePerAccount: 2000,
    maxPositionSize: 2000,
    maxPendingOrderSize: 2000,
    cooldownAfterLosses: 3,
    cooldownDuration: 240,
    maxConsecutiveLosses: 3,
    cooldownHours: 6, // Increase from 4 to 6
    enabledSymbols: ['BTC', 'ETH'],
    allowedSessions: ['all_timeframes'],
    requiredTimeframes: ['4h', '1h'],
    minAlignment: 0.6, // Increase from 0.5 to 0.6
    minSLDistancePercent: 0.0075, // Increase from 0.004 to 0.0075 (0.75%)
    requireConfluence: true,
    minConfluenceCount: 3, // Increase from 2 to 3 (3/4 met - 4/4 too strict for AI)
    requireHighLiquiditySession: false,
    requireMarketStructure: true
  }
}
```

### Step 3: Fix Testnet Equity Calculation

**File:** `src/services/testnetEngine.js`

Find `syncTestnetAccount` function and modify equity calculation:

```javascript
// Current problematic code:
// await updateTestnetAccountEquityDirect(db, account.id, balance.totalWalletBalance);

// Replace with:
const totalUnrealizedPnl = openPositions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);
const calculatedEquity = balance.availableBalance + totalUnrealizedPnl;

const equityDiff = Math.abs(calculatedEquity - account.equity);
if (equityDiff > 0.01) {
  console.log(`[TestnetEngine] Correcting equity for account ${account.id}: DB=${account.equity.toFixed(2)}, Calculated=${calculatedEquity.toFixed(2)}, Binance=${balance.totalWalletBalance.toFixed(2)}`);
  await updateTestnetAccountEquityDirect(db, account.id, calculatedEquity);
}
```

### Step 4: Add Volume Limit Separation

**File:** `src/config/methods.js`

Add new config parameters:

```javascript
autoEntry: {
  // ... existing config ...
  maxVolumePerAccount: 2000,
  maxOpenVolume: 2000, // Add: Max volume for open positions
  maxPendingVolume: 2000, // Add: Max volume for pending orders
  // ... rest of config ...
}
```

**File:** `src/services/autoEntryLogic.js`

Modify volume check logic:

```javascript
// Find the volume check section (around line 200-250)
// Replace existing check with:

const openVolume = totalOpenVolume;
const pendingVolume = totalPendingVolume;
const maxOpenVolume = methodConfig?.autoEntry?.maxOpenVolume || 2000;
const maxPendingVolume = methodConfig?.autoEntry?.maxPendingVolume || 2000;

// Check open volume limit
if (openVolume >= maxOpenVolume) {
  return {
    shouldEnter: false,
    reason: `Open volume $${openVolume.toFixed(2)} at limit $${maxOpenVolume}`
  };
}

// Check pending volume limit separately
if (pendingVolume >= maxPendingVolume) {
  return {
    shouldEnter: false,
    reason: `Pending volume $${pendingVolume.toFixed(2)} at limit $${maxPendingVolume}`
  };
}

// Allow new order even if pending exists, as long as each limit is respected
```

### Step 5: Add Win Rate Based Risk Adjustment

**File:** `src/services/autoEntryLogic.js`

Add function to calculate dynamic risk:

```javascript
function calculateDynamicRisk(account, methodConfig) {
  const totalTrades = account.total_trades || 0;
  const winningTrades = account.winning_trades || 0;
  
  if (totalTrades < 10) {
    return methodConfig.autoEntry.riskPerTrade; // Use default for insufficient data
  }
  
  const winRate = winningTrades / totalTrades;
  const baseRisk = methodConfig.autoEntry.riskPerTrade;
  
  // Adjust risk based on win rate
  if (winRate >= 0.6) {
    return baseRisk; // Full risk for good performance
  } else if (winRate >= 0.4) {
    return baseRisk * 0.8; // Reduce risk by 20% for moderate performance
  } else {
    return baseRisk * 0.5; // Reduce risk by 50% for poor performance
  }
}
```

Use this in position size calculation:

```javascript
// In evaluateAutoEntry, where position size is calculated
const dynamicRisk = calculateDynamicRisk(account, methodConfig);
const positionSizeUsd = account.current_balance * dynamicRisk;
```

### Step 6: Add Entry Timing Validation

**File:** `src/services/autoEntryLogic.js`

Add validation to ensure entry is at pullback level:

```javascript
function validateEntryTiming(suggestedEntry, currentPrice, side, candle) {
  const priceDiff = Math.abs(suggestedEntry - currentPrice) / currentPrice;
  
  // Entry should be at least 0.5% away from current price (pullback)
  if (priceDiff < 0.005) {
    return {
      valid: false,
      reason: `Entry too close to current price (${(priceDiff * 100).toFixed(2)}% < 0.5%)`
    };
  }
  
  // For long: entry should be below current price
  if (side === 'long' && suggestedEntry > currentPrice) {
    return {
      valid: false,
      reason: 'Long entry above current price (not a pullback)'
    };
  }
  
  // For short: entry should be above current price
  if (side === 'short' && suggestedEntry < currentPrice) {
    return {
      valid: false,
      reason: 'Short entry below current price (not a pullback)'
    };
  }
  
  return { valid: true };
}
```

Add to auto-entry checks:

```javascript
// After SL/TP validation
const entryTimingValidation = validateEntryTiming(
  suggestedEntry,
  currentPrice,
  action,
  candle
);

if (!entryTimingValidation.valid) {
  return {
    shouldEnter: false,
    reason: entryTimingValidation.reason
  };
}
```

## Files to Modify

1. `src/schedulers/priceUpdateScheduler.js` - Add stale order cancellation
2. `src/config/methods.js` - Improve SL/TP settings and add volume separation
3. `src/services/testnetEngine.js` - Fix equity calculation
4. `src/services/autoEntryLogic.js` - Add volume separation, dynamic risk, entry timing validation

## Expected Results

1. **Pending orders will auto-cancel** after 24h, unblocking new positions
2. **Tighter entry requirements** (80% confidence, 3.0 RR) will improve win rate
3. **Larger SL distance (0.75%)** will reduce premature stop-outs
4. **Testnet equity will be accurate** by calculating from balance + unrealized PnL
5. **Volume limits separated** - pending orders won't block new positions
6. **Dynamic risk adjustment** will reduce position size during poor performance
7. **Entry timing validation** ensures pullback entries, not chase entries

## Testing

After changes:
1. Restart PM2: `pm2 restart backend`
2. Monitor logs for stale order cancellations
3. Verify new positions can open
4. Check testnet equity calculation in logs
5. Monitor win rate improvement over 10 trades
