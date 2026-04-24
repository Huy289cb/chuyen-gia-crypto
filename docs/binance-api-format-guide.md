# Binance API Format Guide

## Overview

This document describes the format conversions required between the internal system and Binance Futures API. Always use the conversion utilities in `src/utils/binanceFormatConverter.js` to ensure consistency.

## Format Conversions

### Side Parameter

**Internal Format:** `'long'` or `'short'` (lowercase)
**Binance API Format:** `'BUY'` or `'SELL'` (uppercase)

#### Conversion Examples:
```javascript
import { toBinanceSide, fromBinanceSide } from '../utils/binanceFormatConverter.js';

// Internal -> Binance
toBinanceSide('long')   // Returns 'BUY'
toBinanceSide('short')  // Returns 'SELL'

// Binance -> Internal
fromBinanceSide('BUY')   // Returns 'long'
fromBinanceSide('SELL')  // Returns 'short'
```

#### Common Mistakes:
- ❌ `position.side.toUpperCase()` - Converts 'long' to 'LONG' (invalid for Binance)
- ✅ `toBinanceSide(position.side)` - Converts 'long' to 'BUY' (correct)

### Order Type Parameter

**Internal Format:** `'market'`, `'limit'`, `'stop_market'`, etc. (lowercase with underscores)
**Binance API Format:** `'MARKET'`, `'LIMIT'`, `'STOP_MARKET'`, etc. (uppercase with underscores)

#### Conversion Examples:
```javascript
import { toBinanceOrderType } from '../utils/binanceFormatConverter.js';

toBinanceOrderType('market')        // Returns 'MARKET'
toBinanceOrderType('limit')         // Returns 'LIMIT'
toBinanceOrderType('stop_market')  // Returns 'STOP_MARKET'
```

### Other Parameters

#### Numeric Parameters
All numeric parameters must be converted to strings using `.toString()`:
- `quantity`: Must be string
- `price`: Must be string (for LIMIT orders)
- `stopPrice`: Must be string (for STOP orders)
- `leverage`: Must be string
- `orderId`: Must be string

#### String Parameters (already correct format)
- `symbol`: e.g., 'BTCUSDT' (no conversion needed)
- `marginType`: 'ISOLATED' or 'CROSSED' (already uppercase)
- `timeInForce`: 'GTC', 'IOC', 'FOK', 'GTX' (already uppercase)
- `type`: 'MARKET', 'LIMIT', etc. (already uppercase in binanceClient.js)

#### Boolean Parameters
- `reduceOnly`: `true` or `false` (boolean, no conversion needed)
- `dualSidePosition`: `true` or `false` (boolean, no conversion needed)

## Binance API Error Codes

### -1117: Invalid side
**Cause:** Side parameter is not 'BUY' or 'SELL'
**Solution:** Use `toBinanceSide()` to convert internal format

### -1115: Invalid order type
**Cause:** Order type parameter is not a valid Binance order type
**Solution:** Use `toBinanceOrderType()` to convert internal format

### -1100: Illegal characters found
**Cause:** Parameter contains invalid characters or wrong format
**Solution:** Ensure all numeric parameters are converted to strings

## Code Review Checklist

When adding new Binance API calls, verify:

- [ ] Side parameter is converted using `toBinanceSide()`
- [ ] Order type parameter is converted using `toBinanceOrderType()` (if applicable)
- [ ] All numeric parameters are converted to strings with `.toString()`
- [ ] String parameters match Binance expected format (uppercase for enums)
- [ ] Boolean parameters are actual booleans (not strings)

## Examples

### Correct Implementation:
```javascript
import { toBinanceSide } from '../utils/binanceFormatConverter.js';

// Place market order
const binanceSide = toBinanceSide(position.side); // 'long' -> 'BUY'
await placeMarketOrder(client, symbol, binanceSide, quantity.toString());
```

### Incorrect Implementation:
```javascript
// ❌ Wrong: Using toUpperCase()
await placeMarketOrder(client, symbol, position.side.toUpperCase(), quantity);

// ❌ Wrong: Not converting numeric to string
await placeMarketOrder(client, symbol, 'BUY', quantity);

// ❌ Wrong: Hardcoding without conversion
await placeMarketOrder(client, symbol, position.side === 'long' ? 'BUY' : 'SELL', quantity.toString());
```

## Files That Use Binance API

### Direct API Calls:
- `src/services/binanceClient.js` - Wrapper functions for Binance API
- `src/services/binance/trading.js` - Trading endpoints
- `src/services/binance/account.js` - Account endpoints
- `src/services/binance/market.js` - Market data endpoints

### Indirect API Calls (must convert before calling):
- `src/services/testnetEngine.js` - Testnet position management
- `src/scheduler.js` - Order placement and modification
- `src/schedulers/priceUpdateScheduler.js` - Pending order execution

## Testing

To test format conversions:
```javascript
import { toBinanceSide, fromBinanceSide, toBinanceOrderType } from '../utils/binanceFormatConverter.js';

console.assert(toBinanceSide('long') === 'BUY');
console.assert(toBinanceSide('short') === 'SELL');
console.assert(fromBinanceSide('BUY') === 'long');
console.assert(fromBinanceSide('SELL') === 'short');
console.assert(toBinanceOrderType('market') === 'MARKET');
console.assert(toBinanceOrderType('limit') === 'LIMIT');
```

## References

- Binance Futures API Documentation: https://developers.binance.com/docs/derivatives/usdm/introduction
- Error Codes: https://developers.binance.com/docs/derivatives/usdm/trade/rest-api-error-codes
