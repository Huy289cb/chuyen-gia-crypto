/**
 * Market Scan Scheduler
 * Fetches market data and runs signal gate analysis
 * Stores snapshots for later LLM dispatch
 */

import cron, { type ScheduledTask } from 'node-cron';
import { fetchRealTimePrices } from '../services/price-fetcher';
import { saveOhlcvCandle, getOhlcvCandles } from '../repositories/market.repository';
import { signalGateService } from '../services/signal-gate.service';

let marketScanTask: ScheduledTask | null = null;
let isRunning = false;

export interface MarketScanResult {
  symbol: string;
  timeframe: string;
  candles: any[];
  signalResult: any;
  timestamp: Date;
}

const scanResults = new Map<string, MarketScanResult>();

/**
 * Run market scan for configured symbols
 */
async function runMarketScan() {
  if (isRunning) {
    console.warn('[MarketScan] Previous scan still running, skipping cycle');
    return;
  }

  isRunning = true;
  try {
    console.log('[MarketScan] Starting market scan');

    // Fetch real-time prices
    const prices = await fetchRealTimePrices();
    const symbols = ['BTC']; // BTC-only per Big Update Plan v3
    const timeframes = ['15m', '1h', '4h'];

    for (const symbol of symbols) {
      const priceData = symbol === 'BTC' ? prices.btc : prices.eth;
      if (!priceData) continue;

      for (const timeframe of timeframes) {
        // Save OHLCV candle
        const candleId = await saveOhlcvCandle({
          coin: symbol,
          open: priceData.price,
          high: priceData.price * 1.001, // Simplified - should use actual high
          low: priceData.price * 0.999, // Simplified - should use actual low
          close: priceData.price,
          volume: priceData.volume || 0,
          timestamp: new Date(),
          timeframe
        });
        console.log(`[MarketScan] Saved candle for ${symbol} ${timeframe} (ID: ${candleId})`);

        // Run signal gate
        const candles = await getRecentCandles(symbol, timeframe);
        console.log(`[MarketScan] Fetched ${candles.length} candles for ${symbol} ${timeframe}`);
        const signalResult = await signalGateService.evaluate({
          candles,
          symbol,
          timeframe
        });

        // Store result
        const result: MarketScanResult = {
          symbol,
          timeframe,
          candles,
          signalResult,
          timestamp: new Date()
        };

        const key = `${symbol}_${timeframe}`;
        scanResults.set(key, result);

        console.log(`[MarketScan] ${symbol} ${timeframe}: ${signalResult.pass ? 'PASS' : 'BLOCK'} - ${signalResult.reason}`);
      }
    }

    console.log('[MarketScan] Market scan completed');
  } catch (error) {
    console.error('[MarketScan] Error during market scan:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Get recent candles for a symbol and timeframe
 */
async function getRecentCandles(symbol: string, timeframe: string, limit: number = 100) {
  try {
    // Query database for recent candles
    const candles = await getOhlcvCandles(symbol, 168, timeframe); // Get last 7 days (168 hours)
    
    if (!candles || candles.length === 0) {
      console.warn(`[MarketScan] No candles found for ${symbol} ${timeframe}`);
      return [];
    }
    
    // Convert to CandleData format expected by signal gate
    const candleData = candles.map(c => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
      timestamp: c.timestamp.getTime()
    }));
    
    // Return most recent candles up to limit
    return candleData.slice(-limit);
  } catch (error) {
    console.error(`[MarketScan] Error fetching candles for ${symbol} ${timeframe}:`, error);
    return [];
  }
}

/**
 * Get latest scan result for a symbol and timeframe
 */
export function getScanResult(symbol: string, timeframe: string): MarketScanResult | undefined {
  const key = `${symbol}_${timeframe}`;
  return scanResults.get(key);
}

/**
 * Start market scan scheduler
 */
export function startMarketScanScheduler(cronExpression: string = '*/5 * * * *') {
  if (marketScanTask) {
    console.warn('[MarketScan] Scheduler already running');
    return;
  }

  console.log(`[MarketScan] Starting scheduler with cron: ${cronExpression}`);
  marketScanTask = cron.schedule(cronExpression, runMarketScan);
  
  // Run immediately on start
  runMarketScan();
}

/**
 * Stop market scan scheduler
 */
export function stopMarketScanScheduler() {
  if (marketScanTask) {
    marketScanTask.stop();
    marketScanTask = null;
    console.log('[MarketScan] Scheduler stopped');
  }
}

/**
 * Run market scan manually (for testing)
 */
export async function runManualMarketScan() {
  return await runMarketScan();
}
