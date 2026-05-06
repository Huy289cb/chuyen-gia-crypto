# Patch Plan for Continuous Open/Close Orders on Binance Testnet

## Objective

Fix the root cause of continuous order opening/closing on Binance Testnet caused by precision mismatches, and ensure the trading flow is stable, validated before order placement, protected by cooldowns, and free from infinite retry loops.

---

## 1) Actual Root Cause

### 1.1 Primary Error

Binance returns:

```text
-1111: Precision is over the maximum defined for this asset
```

This error usually happens when:

* `quantity` does not match `LOT_SIZE.stepSize`
* `price` / `stopPrice` / `activationPrice` does not match `PRICE_FILTER.tickSize`
* values are rounded using a fixed decimal count instead of Binance filters

### 1.2 Resulting Loop

The failure chain is typically:

1. Bot creates an entry order
2. Entry succeeds
3. SL/TP or protective order fails due to precision
4. Recovery/close logic is triggered
5. Scheduler retries again
6. The cycle repeats continuously

### 1.3 What Was Wrong Before

* Quantity was rounded by a fixed decimal setting, for example `QUANTITY_PRECISION = 3`
* The code did not read precision filters from `exchangeInfo`
* Orders were not validated fully before sending to Binance
* There was no proper cooldown/backoff when the same error repeated
* Retries could happen with the same invalid parameters

---

## 2) Principles of the New Patch

### Must Do

* Read precision rules from Binance `exchangeInfo`
* Normalize quantity and price using `stepSize` and `tickSize`
* Validate all order parameters before placing an order
* Fail fast on precision errors instead of retrying blindly
* If entry succeeds but protective orders fail, roll back safely or move into a clearly controlled state
* Add cooldown when precision errors repeat

### Must Not Do

* Do not keep a position open without protection just because SL/TP failed
* Do not retry forever with the same broken values
* Do not rely only on a hardcoded decimal count

---

## 3) Files to Update

### 3.1 `backend/src/services/testnetEngine.js`

Update the flow to:

* fetch exchange info
* normalize quantity and price
* validate order parameters
* place entry order
* place protective orders
* safely roll back if protective order placement fails
* log detailed information
* apply cooldown when precision failures repeat

### 3.2 `backend/src/schedulers/priceUpdateScheduler.js`

Update the scheduler so it:

* does not trigger new actions while an account is cooling down
* does not create a dense retry loop
* can detect repeated failures and stop escalation

### 3.3 `backend/src/routes/testnet.js`

Optionally add endpoints to:

* view cooldown status
* reset cooldown manually
* inspect the last precision error

---

## 4) Correct Patch Logic

## 4.1 Fetch `exchangeInfo` from Binance

Read symbol metadata from Binance Testnet to get:

* `LOT_SIZE.stepSize`
* `LOT_SIZE.minQty`
* `LOT_SIZE.maxQty`
* `PRICE_FILTER.tickSize`
* `MIN_NOTIONAL` or equivalent filter if available

### Goal

Avoid hardcoded precision.

---

## 4.2 Normalize Quantity by `stepSize`

### Rule

`quantity` must be an exact multiple of `stepSize`.

### Suggested helper

```js
function normalizeToStepSize(value, stepSize) {
  const step = Number(stepSize);
  if (!step || step <= 0) throw new Error(`Invalid stepSize: ${stepSize}`);

  const normalized = Math.floor(Number(value) / step) * step;
  return Number(normalized.toFixed(getDecimalPlaces(stepSize)));
}

function getDecimalPlaces(numStr) {
  const s = String(numStr);
  if (!s.includes('.')) return 0;
  return s.split('.')[1].replace(/0+$/, '').length;
}
```

### Notes

* Do not use `Math.round` for quantity if you want to avoid exceeding the allowed step
* Use `Math.floor` to stay safely within Binance rules

---

## 4.3 Normalize Price / Stop Price by `tickSize`

### Rule

All price-related fields must be exact multiples of `tickSize`.

### Suggested helper

```js
function normalizeToTickSize(price, tickSize) {
  const tick = Number(tickSize);
  if (!tick || tick <= 0) throw new Error(`Invalid tickSize: ${tickSize}`);

  const normalized = Math.floor(Number(price) / tick) * tick;
  return Number(normalized.toFixed(getDecimalPlaces(tickSize)));
}
```

### Apply to

* entry price
* stop loss price
* take profit price
* activation price, if used

---

## 4.4 Validate Before Sending Orders

### Minimum checks

* `quantity > 0`
* `quantity >= minQty`
* `quantity` is aligned with `stepSize`
* `price` / `stopPrice` is aligned with `tickSize`
* `notional = quantity * price` meets the minimum requirement

### Example

```js
function validateOrderParams({ quantity, price, minQty, stepSize, tickSize }) {
  if (quantity <= 0) throw new Error('Quantity must be > 0');
  if (quantity < Number(minQty)) throw new Error(`Quantity below minQty: ${quantity} < ${minQty}`);

  const qtyRemainder = Number(quantity) % Number(stepSize);
  if (qtyRemainder > 1e-12) {
    throw new Error(`Quantity not aligned with stepSize: ${quantity} stepSize=${stepSize}`);
  }

  const priceRemainder = Number(price) % Number(tickSize);
  if (priceRemainder > 1e-12) {
    throw new Error(`Price not aligned with tickSize: ${price} tickSize=${tickSize}`);
  }
}
```

---

## 4.5 Correct Order Flow

### Correct sequence

1. Fetch `exchangeInfo`
2. Read `LOT_SIZE` and `PRICE_FILTER`
3. Normalize `quantity`, `entry price`, `SL`, `TP`
4. Validate all parameters
5. Place entry order
6. Place SL/TP orders
7. If SL/TP fails due to precision:

   * roll back safely according to the rule set
   * do not retry blindly
   * log everything clearly
8. If failures continue, trigger cooldown

---

## 5) What to Do When Protective Orders Fail

## 5.1 Never Leave an Unprotected Position

If entry is filled but SL/TP fails:

* prefer a safe rollback if the position cannot be protected
* or temporarily mark the position as `protection_pending` only for a very short window with limited retry

### Recommendation

Do not allow the bot to continue with an unprotected position unless the risk control process is explicit and safe.

## 5.2 Limited Retry Only

Retry only when:

* the error is a precision-related error
* the parameters are updated using real exchange filters
* the retry count is <= 2 or 3

After that:

* fail fast
* set cooldown for the account
* require manual intervention if needed

---

## 6) Cooldown / Backoff

### Goal

Prevent the open/close loop from repeating endlessly.

### Proposal

* On repeated `-1111` errors, set `cooldown_until`
* While cooling down:

  * no auto-entry
  * no auto-retry of the same logic
  * only sync/monitoring is allowed

### Suggested duration

* initial cooldown: 5 minutes
* if errors continue: back off to 10 minutes, then 30 minutes

---

## 7) Logging Requirements

### Log all of the following

* timestamp with milliseconds
* `symbol`
* `side`
* raw quantity
* normalized quantity
* raw price
* normalized price
* stop price
* `stepSize`
* `tickSize`
* `minQty`
* entry / SL / TP / recovery order IDs
* Binance error code and message
* request context for traceability

### Example

```js
logger.error('Entry protection failed', {
  symbol,
  rawQuantity,
  normalizedQuantity,
  rawPrice,
  normalizedPrice,
  stepSize,
  tickSize,
  errorCode: err.code,
  errorMessage: err.message,
  timestamp: new Date().toISOString(),
});
```

---

## 8) Detect Repeated Error Patterns

### Suggested trigger

If the same account has:

* more than 3 precision errors within 10 minutes
* or more than 5 consecutive entry failures

Then:

* temporarily disable auto-entry
* send an alert
* store a detailed error report
* require manual re-enablement

---

## 9) Pseudo-code for `testnetEngine.js`

```js
async function placeProtectedEntryOrder({ symbol, side, rawQty, rawEntryPrice }) {
  const exchangeInfo = await getExchangeInfo(testnetClient);
  const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
  if (!symbolInfo) throw new Error(`Symbol not found: ${symbol}`);

  const lotSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
  const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
  const minNotional = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');

  const normalizedQty = normalizeToStepSize(rawQty, lotSize.stepSize);
  const normalizedEntry = normalizeToTickSize(rawEntryPrice, priceFilter.tickSize);

  validateOrderParams({
    quantity: normalizedQty,
    price: normalizedEntry,
    minQty: lotSize.minQty,
    stepSize: lotSize.stepSize,
    tickSize: priceFilter.tickSize,
  });

  if (minNotional && normalizedQty * normalizedEntry < Number(minNotional.notional || minNotional.minNotional || 0)) {
    throw new Error(`Notional below minimum: ${normalizedQty * normalizedEntry}`);
  }

  const entryOrder = await placeMarketOrder({ symbol, side, quantity: normalizedQty });

  try {
    const slPrice = normalizeToTickSize(calculateStopLossPrice(normalizedEntry), priceFilter.tickSize);
    const tpPrice = normalizeToTickSize(calculateTakeProfitPrice(normalizedEntry), priceFilter.tickSize);

    await placeStopLossOrder({ symbol, side, quantity: normalizedQty, stopPrice: slPrice });
    await placeTakeProfitOrder({ symbol, side, quantity: normalizedQty, price: tpPrice });
  } catch (err) {
    logger.error('Protective order failed', { symbol, err });

    // Safe rollback or move to a strictly controlled state
    await safeRollbackOrClosePosition({ symbol, side, quantity: normalizedQty });
    throw err;
  }

  return entryOrder;
}
```

---

## 10) Post-Patch Checklist

### Required tests

* Entry succeeds with quantity normalized by `stepSize`
* SL/TP succeeds with `tickSize`
* `-1111` is caught and logged correctly
* No continuous open/close loop occurs
* Cooldown works when errors repeat
* Scheduler does not spam retries
* Manual close/reconcile still works correctly

### Recommended real-world test

* Start with the smallest possible order size
* Test only one symbol first, for example `BTCUSDT`
* Compare order parameters before and after normalization
* Watch logs for at least 30–60 minutes after deployment

---

## 11) Safe Rollout Plan

### Step 1

Disable auto-entry temporarily to stop the current loop immediately.

### Step 2

Update normalize and validation logic using `exchangeInfo`.

### Step 3

Add cooldown and repeated-error detection.

### Step 4

Re-enable the bot with a single test symbol.

### Step 5

Monitor logs and verify that `-1111` no longer appears.

---

## 12) Final Conclusion

The real root cause is **precision mismatch with Binance filters**, not just a fixed decimal precision setting. This patch must prioritize:

* reading `stepSize` and `tickSize` from `exchangeInfo`
* normalizing all order parameters before sending requests
* validating everything before placing an order
* safely rolling back when protective orders fail
* applying cooldown when errors repeat
* logging enough detail to trace the issue quickly

> The final goal is to eliminate the open/close loop, stop infinite retries, and make testnet behavior match paper trading as closely as possible.
