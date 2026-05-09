/**
 * Price Fetcher Service (TypeScript)
 * 
 * Primary source: Binance API (real-time, no rate limit issues)
 * Secondary source: Database OHLCV candles
 * Fallback: CoinGecko API (only if Binance fails)
 */

const BINANCE_API = 'https://api.binance.com/api/v3';

// Delay helper to avoid rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with timeout to prevent hanging in production
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

export interface CandleData {
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  time: string;
}

export interface PriceData {
  timestamp: string;
  btc: CandleData;
  eth?: CandleData;
}

/**
 * Fetch real-time 1-minute candle data from Binance for paper trading
 */
export async function fetchRealTimePrices(): Promise<PriceData> {
  const maxRetries = 3;
  const retryDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const btcRes = await fetchWithTimeout(`${BINANCE_API}/klines?symbol=BTCUSDT&interval=1m&limit=1`, {}, 10000);
      const ethRes = await fetchWithTimeout(`${BINANCE_API}/klines?symbol=ETHUSDT&interval=1m&limit=1`, {}, 10000);

      if (!btcRes.ok || !ethRes.ok) {
        throw new Error(`Binance klines error: BTC=${btcRes.status}, ETH=${ethRes.status}`);
      }

      const btcKline = await btcRes.json() as any[][];
      const ethKline = await ethRes.json() as any[][];

      const btcData: CandleData = {
        price: parseFloat(btcKline[0][4]),
        open: parseFloat(btcKline[0][1]),
        high: parseFloat(btcKline[0][2]),
        low: parseFloat(btcKline[0][3]),
        volume: parseFloat(btcKline[0][5]),
        time: new Date(btcKline[0][0]).toISOString()
      };

      const ethData: CandleData = {
        price: parseFloat(ethKline[0][4]),
        open: parseFloat(ethKline[0][1]),
        high: parseFloat(ethKline[0][2]),
        low: parseFloat(ethKline[0][3]),
        volume: parseFloat(ethKline[0][5]),
        time: new Date(ethKline[0][0]).toISOString()
      };

      return {
        timestamp: new Date().toISOString(),
        btc: btcData,
        eth: ethData
      };
    } catch (error: any) {
      console.error(`[PriceFetcher] 1-minute candle fetch failed (attempt ${attempt}/${maxRetries}):`, error.message);

      if (attempt < maxRetries) {
        await delay(retryDelay);
        continue;
      }

      throw error;
    }
  }

  throw new Error('Failed to fetch prices after all retries');
}

/**
 * Fetch prices from database (fallback for analysis)
 */
export async function fetchPricesFromDb(coin: string = 'BTC'): Promise<CandleData | null> {
  const { getLatestPrice } = await import('../repositories/market.repository');
  const latestPrice = await getLatestPrice(coin);

  if (latestPrice) {
    return {
      price: latestPrice.price,
      open: latestPrice.price,
      high: latestPrice.price,
      low: latestPrice.price,
      volume: latestPrice.volume_24h || 0,
      time: latestPrice.updated_at.toISOString()
    };
  }

  return null;
}

/**
 * Fetch historical OHLCV candles from Binance API
 */
export async function fetchHistoricalCandles(symbol: string, interval: string = '15m', limit: number = 100): Promise<any[]> {
  const maxRetries = 3;
  const retryDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `${BINANCE_API}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`,
        {},
        10000
      );

      if (!response.ok) {
        throw new Error(`Binance klines error: ${response.status}`);
      }

      const klines = await response.json() as any[][];
      return klines;
    } catch (error: any) {
      console.error(`[PriceFetcher] Historical candles fetch failed (attempt ${attempt}/${maxRetries}):`, error.message);

      if (attempt < maxRetries) {
        await delay(retryDelay);
        continue;
      }

      throw error;
    }
  }

  throw new Error('Failed to fetch historical candles after all retries');
}

/**
 * Fetch prices with fallback chain: Binance -> Database -> CoinGecko
 */
export async function fetchPrices(coin: string = 'BTC'): Promise<CandleData> {
  try {
    const prices = await fetchRealTimePrices();
    return prices.btc;
  } catch (error: any) {
    console.warn('[PriceFetcher] Binance fetch failed, trying database fallback:', error.message);

    const dbPrice = await fetchPricesFromDb(coin);
    if (dbPrice) {
      return dbPrice;
    }

    throw new Error('Failed to fetch prices from all sources');
  }
}
