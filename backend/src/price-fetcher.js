// Price Fetcher Module
// Primary source: Binance API (real-time, no rate limit issues)
// Secondary source: Database OHLCV candles
// Fallback: CoinGecko API (only if Binance fails)

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const BINANCE_API = 'https://api.binance.com/api/v3';

// Rate limiting for CoinGecko (free tier: ~10-50 calls/minute)
let lastCoinGeckoCall = 0;
const COINGECKO_MIN_DELAY = 2000; // 2 seconds between CoinGecko calls

// Delay helper to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with timeout to prevent hanging in production
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Fetch real-time 1-minute candle data from Binance for paper trading
 * Binance has much higher rate limits (1200 requests/minute) than CoinGecko
 * This function should be used for paper trading position updates
 * Uses 1-minute candle OHLC data for accurate SL/TP detection
 * @param {Object} db - Database instance for fallback (optional)
 * @returns {Promise<Object>} 1-minute candle data for BTC and ETH
 */
export async function fetchRealTimePrices(db = null) {
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Fetch 1-minute candle data from Binance klines API
      const btcRes = await fetchWithTimeout(`${BINANCE_API}/klines?symbol=BTCUSDT&interval=1m&limit=1`, {}, 10000);
      const ethRes = await fetchWithTimeout(`${BINANCE_API}/klines?symbol=ETHUSDT&interval=1m&limit=1`, {}, 10000);

      if (!btcRes.ok || !ethRes.ok) {
        throw new Error(`Binance klines error: BTC=${btcRes.status}, ETH=${ethRes.status}`);
      }

      const btcKline = await btcRes.json();
      const ethKline = await ethRes.json();

      // Binance klines format: [time, open, high, low, close, volume, ...]
      const btcCandle = btcKline[0];
      const ethCandle = ethKline[0];

      const btcData = {
        price: parseFloat(btcCandle[4]), // close price
        open: parseFloat(btcCandle[1]),
        high: parseFloat(btcCandle[2]),
        low: parseFloat(btcCandle[3]),
        volume: parseFloat(btcCandle[5]),
        time: new Date(btcCandle[0]).toISOString()
      };

      const ethData = {
        price: parseFloat(ethCandle[4]), // close price
        open: parseFloat(ethCandle[1]),
        high: parseFloat(ethCandle[2]),
        low: parseFloat(ethCandle[3]),
        volume: parseFloat(ethCandle[5]),
        time: new Date(ethCandle[0]).toISOString()
      };

      return {
        timestamp: new Date().toISOString(),
        btc: btcData,
        eth: ethData
      };
    } catch (error) {
      console.error(`[PriceFetcher] 1-minute candle fetch failed (attempt ${attempt}/${maxRetries}):`, error.message);

      // If not the last attempt, wait and retry
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }

      // Last attempt failed, try database fallback
      console.log('[PriceFetcher] All retries failed, trying database fallback...');
      if (db) {
        try {
          const { getLatestPrice } = await import('./db/database.js');
          const btcLatest = await getLatestPrice(db, 'BTC');
          const ethLatest = await getLatestPrice(db, 'ETH');

          if (btcLatest && ethLatest) {
            console.log(`[PriceFetcher] Using cached prices from DB - BTC: $${btcLatest.price}, ETH: $${ethLatest.price}`);
            return {
              timestamp: new Date().toISOString(),
              btc: {
                price: parseFloat(btcLatest.price),
                open: parseFloat(btcLatest.price),
                high: parseFloat(btcLatest.price),
                low: parseFloat(btcLatest.price),
                volume: 0,
                time: new Date().toISOString()
              },
              eth: {
                price: parseFloat(ethLatest.price),
                open: parseFloat(ethLatest.price),
                high: parseFloat(ethLatest.price),
                low: parseFloat(ethLatest.price),
                volume: 0,
                time: new Date().toISOString()
              }
            };
          }
        } catch (dbError) {
          console.error('[PriceFetcher] Database fallback failed:', dbError.message);
        }
      }

      throw error;
    }
  }
}

/**
 * Fetch current prices and historical data
 * Priority: 1. Database OHLCV, 2. CoinGecko (with storage to DB)
 * @param {Object} db - Database instance (optional)
 * @param {boolean} forceRealTime - Force real-time fetch (for paper trading)
 * @returns {Promise<Object>} Price data with sparklines
 */
export async function fetchPrices(db = null) {
  try {
    // ALWAYS try to fetch fresh data from Binance first (primary source)
    try {
      const binanceData = await fetchFromBinance();
      
      // Store fresh prices to database if available
      if (db && binanceData) {
        try {
          const { saveOHLCCandleWithTimeframe, saveLatestPrice } = await import('./db/database.js');
          
          // Fetch and save OHLC data from Binance (15m granularity for detailed analysis)
          const btcOHLC = await fetchOHLCFromBinance('BTCUSDT', '15m', 672);
          const ethOHLC = await fetchOHLCFromBinance('ETHUSDT', '15m', 672);
          
          if (btcOHLC.length > 0) {
            let savedCount = 0;
            for (const candle of btcOHLC) {
              try {
                await saveOHLCCandleWithTimeframe(db, 'BTC', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
                savedCount++;
              } catch (saveError) {
                console.error(`[PriceFetcher] Failed to save BTC candle at ${candle.timestamp}:`, saveError.message);
              }
            }
          }
          
          if (ethOHLC.length > 0) {
            let savedCount = 0;
            for (const candle of ethOHLC) {
              try {
                await saveOHLCCandleWithTimeframe(db, 'ETH', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
                savedCount++;
              } catch (saveError) {
                console.error(`[PriceFetcher] Failed to save ETH candle at ${candle.timestamp}:`, saveError.message);
              }
            }
          }
          
          // Save latest prices
          await saveLatestPrice(db, 'BTC', binanceData.btc.price, binanceData.btc.change24h, binanceData.btc.change7d, binanceData.btc.marketCap, binanceData.btc.volume24h);
          await saveLatestPrice(db, 'ETH', binanceData.eth.price, binanceData.eth.change24h, binanceData.eth.change7d, binanceData.eth.marketCap, binanceData.eth.volume24h);
        } catch (saveError) {
          console.log('[PriceFetcher] OHLC save failed:', saveError.message);
        }
      }
      
      return binanceData;
    } catch (apiError) {
      console.log('[PriceFetcher] Binance API failed, trying fallback...');
      
      // Try CoinGecko as secondary source before falling back to DB
      try {
        const coingeckoData = await fetchWithFallback(db);
        return coingeckoData;
      } catch (coingeckoError) {
        console.log('[PriceFetcher] CoinGecko also failed, falling back to database...');
      }
    }
    
    // FINAL FALLBACK: Only use database if both APIs fail
    let btcData = null;
    let ethData = null;
    
    if (db) {
      try {
        const { getOHLCCandles, getLatestPrice } = await import('./db/database.js');
        
        // Get OHLCV candles from DB
        const btcCandles = await getOHLCCandles(db, 'BTC', 168, '15m');
        const ethCandles = await getOHLCCandles(db, 'ETH', 168, '15m');
        
        // Get latest prices from DB
        const btcLatest = await getLatestPrice(db, 'BTC');
        const ethLatest = await getLatestPrice(db, 'ETH');
        
        if (btcCandles.length >= 100 && btcLatest) {
          btcData = processCandleData(btcCandles, btcLatest);
          console.log(`[PriceFetcher] FALLBACK - BTC: ${btcCandles.length} candles from DB (price: $${btcLatest.price})`);
        }
        
        if (ethCandles.length >= 100 && ethLatest) {
          ethData = processCandleData(ethCandles, ethLatest);
          console.log(`[PriceFetcher] FALLBACK - ETH: ${ethCandles.length} candles from DB (price: $${ethLatest.price})`);
        }
      } catch (dbError) {
        console.log('[PriceFetcher] DB fallback failed:', dbError.message);
      }
    }
    
    // If we have DB data, return it as fallback with marketData
    if (btcData && ethData) {
      const fearGreed = await fetchFearGreedIndex();
      const btcCap = btcData?.marketCap || 0;
      const ethCap = ethData?.marketCap || 0;
      const totalCap = btcCap + ethCap;
      
      return {
        timestamp: new Date().toISOString(),
        btc: btcData,
        eth: ethData,
        marketData: {
          fearGreed,
          totalVolume: (btcData?.volume24h || 0) + (ethData?.volume24h || 0),
          btcDominance: totalCap > 0 ? parseFloat(((btcCap / totalCap) * 100).toFixed(2)) : null
        }
      };
    }
    
    // If all fail, throw error
    throw new Error('Unable to fetch prices from any source');
    
  } catch (error) {
    console.error('[PriceFetcher] Error:', error.message);
    throw error;
  }
}

/**
 * Fetch with fallback chain: Binance -> CoinGecko -> DB
 * Used when Binance fails in fetchPrices
 */
async function fetchWithFallback(db) {
  // Try CoinGecko as secondary source
  try {
    console.log('[PriceFetcher] Trying CoinGecko as fallback...');
    const coingeckoData = await fetchFromCoinGecko();
    
    if (db && coingeckoData) {
      try {
        const { saveOHLCCandleWithTimeframe, saveLatestPrice } = await import('./db/database.js');
        
        // Fetch OHLC data from Binance (15m granularity)
        const btcOHLC = await fetchOHLCFromBinance('BTCUSDT', '15m', 672);
        const ethOHLC = await fetchOHLCFromBinance('ETHUSDT', '15m', 672);
        
        if (btcOHLC.length > 0) {
          let savedCount = 0;
          for (const candle of btcOHLC) {
            try {
              await saveOHLCCandleWithTimeframe(db, 'BTC', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
              savedCount++;
            } catch (saveError) {
              console.error(`[PriceFetcher] Failed to save BTC candle at ${candle.timestamp}:`, saveError.message);
            }
          }
          console.log(`[PriceFetcher] Saved ${savedCount}/${btcOHLC.length} BTC OHLC candles from Binance`);
        }
        
        if (ethOHLC.length > 0) {
          let savedCount = 0;
          for (const candle of ethOHLC) {
            try {
              await saveOHLCCandleWithTimeframe(db, 'ETH', candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume, '15m');
              savedCount++;
            } catch (saveError) {
              console.error(`[PriceFetcher] Failed to save ETH candle at ${candle.timestamp}:`, saveError.message);
            }
          }
          console.log(`[PriceFetcher] Saved ${savedCount}/${ethOHLC.length} ETH OHLC candles from Binance`);
        }
        
        // Save latest prices
        await saveLatestPrice(db, 'BTC', coingeckoData.btc.price, coingeckoData.btc.change24h, coingeckoData.btc.change7d, coingeckoData.btc.marketCap, coingeckoData.btc.volume24h);
        await saveLatestPrice(db, 'ETH', coingeckoData.eth.price, coingeckoData.eth.change24h, coingeckoData.eth.change7d, coingeckoData.eth.marketCap, coingeckoData.eth.volume24h);
        
        console.log('[PriceFetcher] Saved CoinGecko prices to database');
      } catch (saveError) {
        console.log('[PriceFetcher] CoinGecko save failed:', saveError.message);
      }
    }
    
    return coingeckoData;
  } catch (coingeckoError) {
    console.log('[PriceFetcher] CoinGecko also failed:', coingeckoError.message);
    throw coingeckoError;
  }
}

/**
 * Process candle data from database into the format needed for analysis
 */
function processCandleData(candles, latest) {
  const closes = candles.map(c => c.close);
  const sparkline7d = closes;
  
  // Extract timeframe data
  const now = new Date();
  const prices1h = candles.filter(c => {
    const candleTime = new Date(c.timestamp);
    return (now - candleTime) <= 60 * 60 * 1000;
  }).map(c => c.close);
  
  const prices4h = candles.filter(c => {
    const candleTime = new Date(c.timestamp);
    return (now - candleTime) <= 4 * 60 * 60 * 1000;
  }).map(c => c.close);
  
  const prices1d = candles.filter(c => {
    const candleTime = new Date(c.timestamp);
    return (now - candleTime) <= 24 * 60 * 60 * 1000;
  }).map(c => c.close);
  
  return {
    price: latest.price,
    change24h: latest.change_24h || 0,
    change7d: latest.change_7d || 0,
    marketCap: latest.market_cap || 0,
    volume24h: latest.volume_24h || 0,
    sparkline7d: sparkline7d,
    prices1h: prices1h.slice(-4),
    prices4h: prices4h.slice(-16),
    prices1d: prices1d.slice(-96)
  };
}

/**
 * Fetch Fear & Greed Index from alternative.me API
 */
async function fetchFearGreedIndex() {
  try {
    const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', {}, 5000);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.data || !data.data[0]) return null;
    
    const item = data.data[0];
    return {
      value: parseInt(item.value),
      classification: item.value_classification,
      timestamp: item.timestamp
    };
  } catch (error) {
    console.log('[PriceFetcher] Fear & Greed fetch failed:', error.message);
    return null;
  }
}

/**
 * Fetch OHLC data from Binance API (for 15m granularity)
 * @param {string} symbol - Trading pair symbol (BTCUSDT, ETHUSDT)
 * @param {string} interval - Timeframe (15m, 1h, 4h, 1d)
 * @param {number} limit - Number of candles (max 1000)
 * @returns {Promise<Array>} OHLC data array
 */
export async function fetchOHLCFromBinance(symbol, interval = '15m', limit = 1000) {
  try {
    const res = await fetchWithTimeout(
      `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      {},
      10000
    );
    
    if (!res.ok) {
      throw new Error(`Binance API error: ${res.status}`);
    }
    
    const klines = await res.json();
    
    // Convert to our format: {timestamp, open, high, low, close, volume}
    // Binance format: [time, open, high, low, close, volume, ...]
    return klines.map(([time, open, high, low, close, volume]) => ({
      timestamp: new Date(time).toISOString(),
      time: Math.floor(time / 1000),
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume)
    }));
  } catch (error) {
    console.error(`[PriceFetcher] Binance OHLC fetch failed for ${symbol}:`, error.message);
    return [];
  }
}

/**
 * Fetch OHLC data from CoinGecko API
 * @param {string} coinId - Coin ID (bitcoin, ethereum)
 * @param {number} days - Number of days (1-365)
 * @returns {Promise<Array>} OHLC data array
 */
export async function fetchOHLCFromCoinGecko(coinId, days = 7) {
  try {
    const res = await fetchWithTimeout(
      `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
      {},
      10000
    );
    
    if (!res.ok) {
      throw new Error(`OHLC API error: ${res.status}`);
    }
    
    const ohlcData = await res.json();
    
    // Convert to our format: {timestamp, open, high, low, close}
    return ohlcData.map(([timestamp, open, high, low, close]) => ({
      timestamp: new Date(timestamp).toISOString(),
      time: Math.floor(timestamp / 1000), // Convert milliseconds to seconds
      open,
      high,
      low,
      close,
      volume: null // OHLC API doesn't provide volume
    }));
  } catch (error) {
    console.error(`[PriceFetcher] OHLC fetch failed for ${coinId}:`, error.message);
    return [];
  }
}

/**
 * Fetch market data from Binance API (replaces CoinGecko)
 * Binance has no rate limit issues and provides consistent pricing
 * @returns {Promise<Object>} Market data with sparklines
 */
async function fetchFromBinance() {
  try {
    // Fetch 24h ticker data for BTC and ETH (includes price, change, volume)
    const btcRes = await fetchWithTimeout(`${BINANCE_API}/ticker/24hr?symbol=BTCUSDT`, {}, 10000);
    const ethRes = await fetchWithTimeout(`${BINANCE_API}/ticker/24hr?symbol=ETHUSDT`, {}, 10000);
    
    if (!btcRes.ok || !ethRes.ok) {
      throw new Error(`Binance ticker error: BTC=${btcRes.status}, ETH=${ethRes.status}`);
    }
    
    const btcData = await btcRes.json();
    const ethData = await ethRes.json();
    
    // Fetch OHLC data for sparklines (7 days of 15m candles = 672 candles)
    const btcOHLC = await fetchOHLCFromBinance('BTCUSDT', '15m', 672);
    const ethOHLC = await fetchOHLCFromBinance('ETHUSDT', '15m', 672);
    
    // Extract sparklines from OHLC data
    const btcSparkline = btcOHLC.map(c => c.close);
    const ethSparkline = ethOHLC.map(c => c.close);
    
    // Fetch Fear & Greed Index (still from alternative.me)
    const fearGreed = await fetchFearGreedIndex();
    
    // Calculate total volume
    const totalVolume = parseFloat(btcData.quoteVolume) + parseFloat(ethData.quoteVolume);
    
    // Calculate market cap (approximate: price * circulating supply)
    // Binance doesn't provide market cap directly, so we use quoteVolume as proxy
    const btcMarketCap = parseFloat(btcData.quoteVolume); // 24h quote volume
    const ethMarketCap = parseFloat(ethData.quoteVolume);
    
    return {
      timestamp: new Date().toISOString(),
      btc: {
        price: parseFloat(btcData.lastPrice),
        change24h: parseFloat(btcData.priceChangePercent),
        change7d: 0, // Binance 24h ticker doesn't provide 7d change
        marketCap: btcMarketCap,
        volume24h: parseFloat(btcData.quoteVolume),
        sparkline7d: btcSparkline,
        prices1h: extractTimeframeData(btcSparkline, 1),
        prices4h: extractTimeframeData(btcSparkline, 4),
        prices1d: btcSparkline.slice(-96)
      },
      eth: {
        price: parseFloat(ethData.lastPrice),
        change24h: parseFloat(ethData.priceChangePercent),
        change7d: 0, // Binance 24h ticker doesn't provide 7d change
        marketCap: ethMarketCap,
        volume24h: parseFloat(ethData.quoteVolume),
        sparkline7d: ethSparkline,
        prices1h: extractTimeframeData(ethSparkline, 1),
        prices4h: extractTimeframeData(ethSparkline, 4),
        prices1d: ethSparkline.slice(-96)
      },
      marketData: {
        fearGreed,
        totalVolume,
        btcDominance: btcMarketCap && ethMarketCap 
          ? parseFloat((btcMarketCap / (btcMarketCap + ethMarketCap) * 100).toFixed(2))
          : null
      }
    };
  } catch (error) {
    console.error('[PriceFetcher] Binance fetch failed:', error.message);
    throw error;
  }
}

/**
 * Fetch from CoinGecko API with market data
 * Includes rate limiting to avoid hitting CoinGecko free tier limits
 * Only used as fallback if Binance fails
 */
async function fetchFromCoinGecko() {
  // Rate limiting: wait if called too recently
  const now = Date.now();
  const timeSinceLastCall = now - lastCoinGeckoCall;
  if (timeSinceLastCall < COINGECKO_MIN_DELAY) {
    const waitTime = COINGECKO_MIN_DELAY - timeSinceLastCall;
    console.log(`[PriceFetcher] Rate limiting: waiting ${waitTime}ms before CoinGecko call`);
    await delay(waitTime);
  }
  lastCoinGeckoCall = Date.now();

  // Get current prices
  const priceRes = await fetchWithTimeout(
    `${COINGECKO_API}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
    {},
    10000
  );
  
  if (!priceRes.ok) {
    if (priceRes.status === 429) {
      throw new Error('CoinGecko rate limit exceeded (429). Please wait or use Binance API for real-time prices.');
    }
    throw new Error(`Price API error: ${priceRes.status}`);
  }
  
  const prices = await priceRes.json();
  
  await delay(1000);
  
  // Get market data with sparklines AND volume
  const marketRes = await fetchWithTimeout(
    `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=true&price_change_percentage=24h,7d`,
    {},
    10000
  );
  
  if (!marketRes.ok) {
    if (marketRes.status === 429) {
      throw new Error('CoinGecko rate limit exceeded (429). Please wait or use Binance API for real-time prices.');
    }
    throw new Error(`Market API error: ${marketRes.status}`);
  }
  
  const markets = await marketRes.json();
  
  const btcMarket = markets.find(m => m.id === 'bitcoin');
  const ethMarket = markets.find(m => m.id === 'ethereum');
  
  // Fetch Fear & Greed in parallel
  const fearGreed = await fetchFearGreedIndex();
  
  // Calculate total volume
  const totalVolume = (btcMarket?.total_volume || 0) + (ethMarket?.total_volume || 0);
  
  return {
    timestamp: new Date().toISOString(),
    btc: {
      price: prices.bitcoin.usd,
      change24h: prices.bitcoin.usd_24h_change || 0,
      change7d: btcMarket?.price_change_percentage_7d_in_currency || 0,
      marketCap: prices.bitcoin.usd_market_cap || 0,
      volume24h: btcMarket?.total_volume || 0,
      sparkline7d: btcMarket?.sparkline_in_7d?.price || [],
      prices1h: extractTimeframeData(btcMarket?.sparkline_in_7d?.price, 1),
      prices4h: extractTimeframeData(btcMarket?.sparkline_in_7d?.price, 4),
      prices1d: btcMarket?.sparkline_in_7d?.price?.slice(-24) || []
    },
    eth: {
      price: prices.ethereum.usd,
      change24h: prices.ethereum.usd_24h_change || 0,
      change7d: ethMarket?.price_change_percentage_7d_in_currency || 0,
      marketCap: prices.ethereum.usd_market_cap || 0,
      volume24h: ethMarket?.total_volume || 0,
      sparkline7d: ethMarket?.sparkline_in_7d?.price || [],
      prices1h: extractTimeframeData(ethMarket?.sparkline_in_7d?.price, 1),
      prices4h: extractTimeframeData(ethMarket?.sparkline_in_7d?.price, 4),
      prices1d: ethMarket?.sparkline_in_7d?.price?.slice(-24) || []
    },
    marketData: {
      fearGreed,
      totalVolume,
      btcDominance: btcMarket?.market_cap && ethMarket?.market_cap 
        ? parseFloat((btcMarket.market_cap / (btcMarket.market_cap + ethMarket.market_cap) * 100).toFixed(2))
        : null
    }
  };
}

/**
 * Extract specific timeframe data from 7-day sparkline
 * CoinGecko sparkline has hourly data = ~168 points for 7 days
 * @param {number[]} sparkline - Full 7-day sparkline
 * @param {number} hours - Hours to extract
 * @returns {number[]} Extracted price points
 */
function extractTimeframeData(sparkline, hours) {
  if (!sparkline || !Array.isArray(sparkline) || sparkline.length === 0) {
    console.log(`[PriceFetcher] No sparkline data for ${hours}h extraction`);
    return [];
  }
  
  // CoinGecko sparkline_in_7d typically has hourly data = ~168 points
  // But can vary, so we calculate based on actual length
  const totalPoints = sparkline.length;
  const totalHours = 7 * 24; // 168 hours in 7 days
  const pointsPerHour = totalPoints / totalHours;
  
  const pointsToTake = Math.max(2, Math.floor(hours * pointsPerHour));
  const result = sparkline.slice(-pointsToTake);
  
  console.log(`[PriceFetcher] Extracted ${result.length} points for ${hours}h from ${totalPoints} total points`);
  return result;
}

/**
 * Calculate trend from price array
 * @param {number[]} prices - Price array
 * @returns {string} Trend classification
 */
export function calculateTrend(prices) {
  if (!prices || prices.length < 2) return 'neutral';
  
  const first = prices[0];
  const last = prices[prices.length - 1];
  const change = (last - first) / first;
  
  // Classification based on percentage change
  if (change > 0.05) return 'strong_uptrend';
  if (change > 0.02) return 'uptrend';
  if (change > 0.005) return 'bullish';
  if (change > -0.005) return 'neutral';
  if (change > -0.02) return 'bearish';
  if (change > -0.05) return 'downtrend';
  return 'strong_downtrend';
}

/**
 * Calculate confidence based on trend consistency
 * @param {Object} trends - Trends by timeframe
 * @returns {number} Confidence score 0-1
 */
export function calculateConfidence(trends) {
  const values = Object.values(trends);
  
  // Count bullish vs bearish
  const bullish = values.filter(v => 
    ['strong_uptrend', 'uptrend', 'bullish'].includes(v)
  ).length;
  const bearish = values.filter(v => 
    ['strong_downtrend', 'downtrend', 'bearish'].includes(v)
  ).length;
  const neutral = values.filter(v => 
    ['neutral', 'consolidating'].includes(v)
  ).length;
  
  // High agreement
  if (bullish >= 3 || bearish >= 3) return 0.80;
  if (bullish === 2 && bearish === 0) return 0.70;
  if (bearish === 2 && bullish === 0) return 0.70;
  
  // Moderate
  if (bullish === 2 || bearish === 2) return 0.60;
  if (neutral >= 2) return 0.50;
  
  // Low agreement
  return 0.35;
}
