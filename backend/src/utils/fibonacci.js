// Fibonacci calculation utility
// Automatically calculates Fibonacci levels from swing high/low

/**
 * Detect swing high/low from OHLC data
 * @param {Array} ohlcData - Array of OHLC candles {time, open, high, low, close}
 * @param {number} lookback - Number of candles to look back for swing detection (default: 20)
 * @returns {Object} { swingHigh, swingLow, swingHighTime, swingLowTime }
 */
export function detectSwingPoints(ohlcData, lookback = 20) {
  if (!ohlcData || ohlcData.length < lookback * 2) {
    return { swingHigh: null, swingLow: null, swingHighTime: null, swingLowTime: null };
  }

  const recentData = ohlcData.slice(-lookback * 2);
  let swingHigh = recentData[0].high;
  let swingLow = recentData[0].low;
  let swingHighTime = recentData[0].time;
  let swingLowTime = recentData[0].time;

  for (let i = 1; i < recentData.length; i++) {
    const candle = recentData[i];
    
    // Check for swing high (higher than surrounding candles)
    if (candle.high > swingHigh) {
      let isSwingHigh = true;
      for (let j = Math.max(0, i - lookback); j < Math.min(recentData.length, i + lookback); j++) {
        if (recentData[j].high > candle.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        swingHigh = candle.high;
        swingHighTime = candle.time;
      }
    }

    // Check for swing low (lower than surrounding candles)
    if (candle.low < swingLow) {
      let isSwingLow = true;
      for (let j = Math.max(0, i - lookback); j < Math.min(recentData.length, i + lookback); j++) {
        if (recentData[j].low < candle.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        swingLow = candle.low;
        swingLowTime = candle.time;
      }
    }
  }

  return { swingHigh, swingLow, swingHighTime, swingLowTime };
}

/**
 * Calculate Fibonacci retracement and extension levels
 * @param {number} swingHigh - Swing high price
 * @param {number} swingLow - Swing low price
 * @param {string} direction - 'up' (bullish) or 'down' (bearish)
 * @returns {Object} { retracement: [], extension: [] }
 */
export function calculateFibonacciLevels(swingHigh, swingLow, direction = 'up') {
  if (!swingHigh || !swingLow || swingHigh <= swingLow) {
    return {
      retracement: [],
      extension: []
    };
  }

  const range = swingHigh - swingLow;
  const retracementLevels = [0.382, 0.5, 0.618];
  const extensionLevels = [1.272, 1.618];

  const retracement = retracementLevels.map(level => ({
    level,
    price: direction === 'up' ? swingHigh - (range * level) : swingLow + (range * level),
    label: `${(level * 100).toFixed(1)}%`
  }));

  const extension = extensionLevels.map(level => ({
    level,
    price: direction === 'up' ? swingHigh + (range * level) : swingLow - (range * level),
    label: `${(level * 100).toFixed(1)}%`
  }));

  return { retracement, extension };
}

/**
 * Get Fibonacci levels from OHLC data
 * @param {Array} ohlcData - Array of OHLC candles
 * @param {string} direction - 'up' (bullish) or 'down' (bearish)
 * @param {number} lookback - Lookback period for swing detection
 * @returns {Object} { retracement: [], extension: [], swingHigh, swingLow }
 */
export function getFibonacciFromOHLC(ohlcData, direction = 'up', lookback = 20) {
  const { swingHigh, swingLow } = detectSwingPoints(ohlcData, lookback);
  const levels = calculateFibonacciLevels(swingHigh, swingLow, direction);

  return {
    ...levels,
    swingHigh,
    swingLow
  };
}
