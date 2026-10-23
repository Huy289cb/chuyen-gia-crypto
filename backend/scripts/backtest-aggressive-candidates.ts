/**
 * Comprehensive Backtest Engine for Aggressive High-ROI Trading Candidates
 *
 * Parameters:
 * - Capital Base: 100 USDT
 * - Target: >= 0.2%/day (>= 0.20 USDT/day, ~73% APY)
 * - Risk Ceiling: Maximum 12%/day (12.0 USDT/day hard circuit breaker)
 * - Realistic Binance Constraints:
 *   - Min Notional: 5.0 USDT
 *   - Maker Fee: 0.02% (2 bps)
 *   - Taker Fee: 0.05% (5 bps) + 0.02% adverse slippage = 0.07% total
 *
 * Strategies Evaluated:
 * 1. Dynamic Grid Maker (Passivbot Style) on 1h SOLUSDT & DOGEUSDT
 * 2. Wick Recovery / Liquidation Cascade Sniper on 15m SOLUSDT & ETHUSDT
 * 3. Volatility Range Breakout (Donchian 24h + ATR Trail) on 1h SOLUSDT & ETHUSDT
 * 4. Multi-Year Macro Momentum Rotation on 1500-day daily-source.csv (40 coins)
 */

import * as fs from 'fs';
import * as path from 'path';

// --- DATA TYPES & CACHING ---

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface DayMetric {
  date: string;
  startEquity: number;
  endEquity: number;
  pnl: number;
  roiPct: number;
  trades: number;
  breakerTriggered: boolean;
}

export interface BacktestSummary {
  strategyName: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  totalRoiPct: number;
  meanDailyPnl: number;
  meanDailyRoiPct: number;
  annualizedRoiPct: number;
  worstDayPnl: number;
  worstDayPct: number;
  bestDayPnl: number;
  maxDrawdownPct: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  breakerDaysCount: number;
  meetsTarget: boolean; // >= 0.2%/day
  respectsRiskCap: boolean; // worst day >= -12.0 USDT
}

// Ensure cache directory exists
const CACHE_DIR = path.resolve(__dirname, '../data/backtest-cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Fetch candles with local disk caching
export async function getBinanceCandles(
  symbol: string,
  interval: string,
  totalBars: number
): Promise<Candle[]> {
  const cacheFile = path.join(CACHE_DIR, `${symbol}_${interval}_${totalBars}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length >= totalBars * 0.95) {
        return data;
      }
    } catch (e) {
      // cache corrupted, re-fetch
    }
  }

  console.log(`[Fetcher] Fetching ${totalBars} bars for ${symbol} (${interval}) from Binance...`);
  let candles: any[] = [];
  let endTime = Date.now();

  while (candles.length < totalBars) {
    const limit = Math.min(1500, totalBars - candles.length);
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    }
    const data: any = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    candles = data.concat(candles);
    endTime = data[0][0] - 1;
    if (data.length < limit) break;
    // Brief delay to be polite
    await new Promise((r) => setTimeout(r, 60));
  }

  // Deduplicate and map
  const map = new Map<number, Candle>();
  for (const row of candles) {
    map.set(row[0], {
      openTime: row[0],
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[5]),
      closeTime: row[6],
    });
  }

  const sorted = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
  fs.writeFileSync(cacheFile, JSON.stringify(sorted));
  console.log(`[Fetcher] Loaded ${sorted.length} candles for ${symbol} (${interval})`);
  return sorted;
}

// Helper: Calculate Day key YYYY-MM-DD
function getDayKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  return d.toISOString().slice(0, 10);
}

// Helper: Technical indicators
function calcEMA(prices: number[], period: number): number[] {
  const ema = new Array(prices.length).fill(0);
  if (prices.length < period) return ema;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calcATR(candles: Candle[], period: number): number[] {
  const atr = new Array(candles.length).fill(0);
  if (candles.length < period + 1) return atr;

  const trs: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    trs.push(Math.max(hl, hpc, lpc));
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  atr[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcSMA(values: number[], period: number): number[] {
  const sma = new Array(values.length).fill(0);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    sma[i] = sum / period;
  }
  return sma;
}

// ============================================================================
// STRATEGY 1: DYNAMIC GRID MAKER (Passivbot Style)
// ============================================================================
export function runGridMakerBacktest(
  candles: Candle[],
  symbol: string,
  initialCapital = 100.0,
  gridStepPct = 0.012, // 1.2% spacing
  ticketUsd = 8.0, // 8 USDT per grid level (well above 5u min notional)
  maxLevels = 4, // max 4 simultaneous orders ($32 max exposure)
  makerFee = 0.0002, // 0.02% maker
  takerFee = 0.0007 // 0.05% taker + 0.02% adverse slip
): BacktestSummary {
  const closes = candles.map((c) => c.close);
  const ema = calcEMA(closes, 100);

  let cash = initialCapital;
  let dayStartEquity = initialCapital;
  let currentDay = getDayKey(candles[0].openTime);
  let breakerActive = false;

  interface PositionLevel {
    entryPrice: number;
    qty: number;
    tpPrice: number;
  }
  let openLevels: PositionLevel[] = [];
  const dailyMetrics: DayMetric[] = [];
  let dayTrades = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  function getEquity(currentPrice: number): number {
    let unrealized = 0;
    for (const lvl of openLevels) {
      unrealized += (currentPrice - lvl.entryPrice) * lvl.qty;
    }
    return cash + unrealized;
  }

  for (let i = 100; i < candles.length; i++) {
    const bar = candles[i];
    const today = getDayKey(bar.openTime);

    // New day reset
    if (today !== currentDay) {
      const endEq = getEquity(bar.open);
      const dayPnl = endEq - dayStartEquity;
      dailyMetrics.push({
        date: currentDay,
        startEquity: dayStartEquity,
        endEquity: endEq,
        pnl: dayPnl,
        roiPct: (dayPnl / dayStartEquity) * 100,
        trades: dayTrades,
        breakerTriggered: breakerActive,
      });

      currentDay = today;
      dayStartEquity = endEq;
      breakerActive = false;
      dayTrades = 0;
    }

    const currentEquity = getEquity(bar.close);

    // --- CIRCUIT BREAKER CHECK ---
    const intradayLoss = currentEquity - dayStartEquity;
    if (intradayLoss <= -12.0 && !breakerActive) {
      // Hard circuit breaker triggered!
      breakerActive = true;
      // Market close all positions
      for (const lvl of openLevels) {
        const pnl = (bar.close - lvl.entryPrice) * lvl.qty;
        const fee = bar.close * lvl.qty * takerFee;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
        dayTrades++;
      }
      openLevels = [];
      continue; // Skip further trading on this bar
    }

    if (breakerActive) {
      continue; // Halted for rest of the day
    }

    // --- GRID EXECUTION (MAKER) ---
    // 1. Check Take Profit hits for open levels
    const remainingLevels: PositionLevel[] = [];
    for (const lvl of openLevels) {
      if (bar.high >= lvl.tpPrice) {
        // Limit TP filled at tpPrice!
        const pnl = (lvl.tpPrice - lvl.entryPrice) * lvl.qty;
        const fee = lvl.tpPrice * lvl.qty * makerFee;
        cash += pnl - fee;
        winningTrades++;
        grossProfit += pnl;
        dayTrades++;
      } else {
        remainingLevels.push(lvl);
      }
    }
    openLevels = remainingLevels;

    // 2. Check Limit Buy entries
    const anchor = ema[i];
    if (openLevels.length < maxLevels && anchor > 0) {
      // Calculate next limit order price
      const levelIdx = openLevels.length;
      const targetLimitBuy = anchor * (1 - (levelIdx + 1) * gridStepPct);

      if (bar.low <= targetLimitBuy) {
        // Limit buy filled!
        const fillPrice = targetLimitBuy;
        const qty = ticketUsd / fillPrice;
        const fee = ticketUsd * makerFee;
        cash -= fee;
        const tpPrice = fillPrice * (1 + gridStepPct * 1.2); // 1.2x grid step TP
        openLevels.push({
          entryPrice: fillPrice,
          qty,
          tpPrice,
        });
      }
    }
  }

  // Final day record
  const finalPrice = candles[candles.length - 1].close;
  const finalEquity = getEquity(finalPrice);
  const lastDayPnl = finalEquity - dayStartEquity;
  dailyMetrics.push({
    date: currentDay,
    startEquity: dayStartEquity,
    endEquity: finalEquity,
    pnl: lastDayPnl,
    roiPct: (lastDayPnl / dayStartEquity) * 100,
    trades: dayTrades,
    breakerTriggered: breakerActive,
  });

  return summarizeBacktest(
    'Dynamic Grid Maker (Passivbot Style)',
    symbol,
    '1h',
    candles,
    initialCapital,
    finalEquity,
    dailyMetrics,
    winningTrades,
    losingTrades,
    grossProfit,
    grossLoss
  );
}

// ============================================================================
// STRATEGY 2: WICK RECOVERY / LIQUIDATION CASCADE SNIPER
// ============================================================================
export function runWickRecoveryBacktest(
  candles: Candle[],
  symbol: string,
  initialCapital = 100.0,
  riskPerTradeUsd = 5.0, // 5% of 100u account per trade
  targetRR = 2.2, // R:R = 1:2.2
  takerFee = 0.0007 // 0.05% + 0.02% slippage
): BacktestSummary {
  const volumes = candles.map((c) => c.volume);
  const volSMA = calcSMA(volumes, 20);

  let cash = initialCapital;
  let dayStartEquity = initialCapital;
  let currentDay = getDayKey(candles[0].openTime);
  let breakerActive = false;
  let dayLossSum = 0;

  interface TradePosition {
    entryPrice: number;
    qty: number;
    slPrice: number;
    tpPrice: number;
  }
  let currentPos: TradePosition | null = null;
  const dailyMetrics: DayMetric[] = [];
  let dayTrades = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  function getEquity(currentPrice: number): number {
    if (!currentPos) return cash;
    return cash + (currentPrice - currentPos.entryPrice) * currentPos.qty;
  }

  for (let i = 25; i < candles.length; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];
    const today = getDayKey(bar.openTime);

    if (today !== currentDay) {
      const endEq = getEquity(bar.open);
      const dayPnl = endEq - dayStartEquity;
      dailyMetrics.push({
        date: currentDay,
        startEquity: dayStartEquity,
        endEquity: endEq,
        pnl: dayPnl,
        roiPct: (dayPnl / dayStartEquity) * 100,
        trades: dayTrades,
        breakerTriggered: breakerActive,
      });

      currentDay = today;
      dayStartEquity = endEq;
      breakerActive = false;
      dayLossSum = 0;
      dayTrades = 0;
    }

    const currentEquity = getEquity(bar.close);
    if ((currentEquity - dayStartEquity <= -12.0 || dayLossSum >= 12.0) && !breakerActive) {
      breakerActive = true;
      if (currentPos) {
        const pnl = (bar.close - currentPos.entryPrice) * currentPos.qty;
        const fee = bar.close * currentPos.qty * takerFee;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
          dayLossSum += Math.abs(pnl) + fee;
        }
        dayTrades++;
        currentPos = null;
      }
      continue;
    }

    if (breakerActive) continue;

    // Check existing position TP / SL
    if (currentPos) {
      let closed = false;
      let exitPrice = 0;
      let isWin = false;

      // Check SL hit
      if (bar.low <= currentPos.slPrice) {
        closed = true;
        exitPrice = currentPos.slPrice;
        isWin = false;
      } else if (bar.high >= currentPos.tpPrice) {
        closed = true;
        exitPrice = currentPos.tpPrice;
        isWin = true;
      }

      if (closed) {
        const pnl = (exitPrice - currentPos.entryPrice) * currentPos.qty;
        const fee = exitPrice * currentPos.qty * takerFee;
        cash += pnl - fee;
        if (isWin) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
          dayLossSum += Math.abs(pnl) + fee;
        }
        dayTrades++;
        currentPos = null;
      }
    }

    // Check entry signal if flat
    if (!currentPos && !breakerActive) {
      // Detection:
      // 1. Previous candle is a liquidation flush: Drop >= 2.5% from open to low
      const candleDropPct = (prevBar.open - prevBar.low) / prevBar.open;
      const totalRange = prevBar.high - prevBar.low;
      const lowerWick = Math.min(prevBar.open, prevBar.close) - prevBar.low;
      const wickRatio = totalRange > 0 ? lowerWick / totalRange : 0;
      const volSurge = prevBar.volume / (volSMA[i - 1] || 1);

      if (candleDropPct >= 0.025 && wickRatio >= 0.28 && volSurge >= 1.8) {
        // Confirmation: current candle opens or moves above previous close
        const entryPrice = bar.open;
        const slPrice = prevBar.low * 0.998; // 0.2% below wick
        const riskDistance = entryPrice - slPrice;

        if (riskDistance > 0 && (riskDistance / entryPrice) <= 0.035) {
          // Position Sizing: Risk exactly $5.0 USD
          let notional = (riskPerTradeUsd / (riskDistance / entryPrice));
          // Enforce Binance Min Notional 5u and maximum 50u (5x margin on 100u)
          notional = Math.max(5.5, Math.min(50.0, notional));
          const qty = notional / entryPrice;
          const tpPrice = entryPrice + riskDistance * targetRR;

          const fee = notional * takerFee;
          cash -= fee;
          currentPos = {
            entryPrice,
            qty,
            slPrice,
            tpPrice,
          };
        }
      }
    }
  }

  const finalPrice = candles[candles.length - 1].close;
  const finalEquity = getEquity(finalPrice);
  const lastDayPnl = finalEquity - dayStartEquity;
  dailyMetrics.push({
    date: currentDay,
    startEquity: dayStartEquity,
    endEquity: finalEquity,
    pnl: lastDayPnl,
    roiPct: (lastDayPnl / dayStartEquity) * 100,
    trades: dayTrades,
    breakerTriggered: breakerActive,
  });

  return summarizeBacktest(
    'Wick Recovery Sniper',
    symbol,
    '15m',
    candles,
    initialCapital,
    finalEquity,
    dailyMetrics,
    winningTrades,
    losingTrades,
    grossProfit,
    grossLoss
  );
}

// ============================================================================
// STRATEGY 3: VOLATILITY RANGE BREAKOUT (Donchian 24h + ATR Trail)
// ============================================================================
export function runRangeBreakoutBacktest(
  candles: Candle[],
  symbol: string,
  initialCapital = 100.0,
  atrPeriod = 14,
  trailAtrMult = 1.8,
  positionNotional = 25.0, // 25 USDT notional (2.5x leverage margin ~ 10u)
  takerFee = 0.0007
): BacktestSummary {
  const atrs = calcATR(candles, atrPeriod);

  let cash = initialCapital;
  let dayStartEquity = initialCapital;
  let currentDay = getDayKey(candles[0].openTime);
  let breakerActive = false;

  interface BreakoutPos {
    entryPrice: number;
    qty: number;
    trailingStop: number;
    highestPrice: number;
  }
  let currentPos: BreakoutPos | null = null;
  const dailyMetrics: DayMetric[] = [];
  let dayTrades = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  function getEquity(currentPrice: number): number {
    if (!currentPos) return cash;
    return cash + (currentPrice - currentPos.entryPrice) * currentPos.qty;
  }

  for (let i = 30; i < candles.length; i++) {
    const bar = candles[i];
    const today = getDayKey(bar.openTime);

    if (today !== currentDay) {
      const endEq = getEquity(bar.open);
      const dayPnl = endEq - dayStartEquity;
      dailyMetrics.push({
        date: currentDay,
        startEquity: dayStartEquity,
        endEquity: endEq,
        pnl: dayPnl,
        roiPct: (dayPnl / dayStartEquity) * 100,
        trades: dayTrades,
        breakerTriggered: breakerActive,
      });

      currentDay = today;
      dayStartEquity = endEq;
      breakerActive = false;
      dayTrades = 0;
    }

    const currentEquity = getEquity(bar.close);
    if (currentEquity - dayStartEquity <= -12.0 && !breakerActive) {
      breakerActive = true;
      if (currentPos) {
        const pnl = (bar.close - currentPos.entryPrice) * currentPos.qty;
        const fee = bar.close * currentPos.qty * takerFee;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
        dayTrades++;
        currentPos = null;
      }
      continue;
    }

    if (breakerActive) continue;

    // Manage open position
    if (currentPos) {
      // Update trailing stop
      if (bar.high > currentPos.highestPrice) {
        currentPos.highestPrice = bar.high;
        const newStop = bar.high - atrs[i] * trailAtrMult;
        if (newStop > currentPos.trailingStop) {
          currentPos.trailingStop = newStop;
        }
      }

      // Check stop hit
      if (bar.low <= currentPos.trailingStop) {
        const exitPrice = currentPos.trailingStop;
        const pnl = (exitPrice - currentPos.entryPrice) * currentPos.qty;
        const fee = exitPrice * currentPos.qty * takerFee;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
        dayTrades++;
        currentPos = null;
      }
    }

    // Look for breakout entry
    if (!currentPos && !breakerActive) {
      // 24h Donchian High (24 bars on 1h)
      let donchianHigh = 0;
      for (let j = i - 24; j < i; j++) {
        if (candles[j].high > donchianHigh) donchianHigh = candles[j].high;
      }

      if (bar.close > donchianHigh && atrs[i] > atrs[i - 5]) {
        const entryPrice = bar.close;
        const qty = positionNotional / entryPrice;
        const initialStop = entryPrice - atrs[i] * trailAtrMult;
        const fee = positionNotional * takerFee;
        cash -= fee;

        currentPos = {
          entryPrice,
          qty,
          trailingStop: initialStop,
          highestPrice: bar.high,
        };
      }
    }
  }

  const finalPrice = candles[candles.length - 1].close;
  const finalEquity = getEquity(finalPrice);
  const lastDayPnl = finalEquity - dayStartEquity;
  dailyMetrics.push({
    date: currentDay,
    startEquity: dayStartEquity,
    endEquity: finalEquity,
    pnl: lastDayPnl,
    roiPct: (lastDayPnl / dayStartEquity) * 100,
    trades: dayTrades,
    breakerTriggered: breakerActive,
  });

  return summarizeBacktest(
    'Range Breakout (Donchian 24h + ATR Trail)',
    symbol,
    '1h',
    candles,
    initialCapital,
    finalEquity,
    dailyMetrics,
    winningTrades,
    losingTrades,
    grossProfit,
    grossLoss
  );
}

// ============================================================================
// STRATEGY 4: MULTI-YEAR MACRO MOMENTUM (1500 Days on daily-source.csv)
// ============================================================================
export function runMacroDailyBacktest(
  csvPath: string,
  initialCapital = 100.0,
  rebalanceDays = 7,
  allocationPerCoin = 40.0 // $40 each for top 2 coins
): BacktestSummary {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');
  const symbols = header.slice(1);

  interface DayRecord {
    date: string;
    prices: Record<string, number>;
  }

  const records: DayRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const date = parts[0];
    const prices: Record<string, number> = {};
    for (let s = 0; s < symbols.length; s++) {
      const p = parseFloat(parts[s + 1]);
      if (!isNaN(p) && p > 0) prices[symbols[s]] = p;
    }
    records.push({ date, prices });
  }

  let cash = initialCapital;
  let dayStartEquity = initialCapital;
  let breakerActive = false;
  const dailyMetrics: DayMetric[] = [];

  interface HeldCoin {
    symbol: string;
    entryPrice: number;
    qty: number;
  }
  let heldCoins: HeldCoin[] = [];
  let winningTrades = 0;
  let losingTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let daysSinceRebalance = 0;

  function getDailyEquity(prices: Record<string, number>): number {
    let unrl = 0;
    for (const h of heldCoins) {
      const p = prices[h.symbol] || h.entryPrice;
      unrl += (p - h.entryPrice) * h.qty;
    }
    return cash + unrl;
  }

  for (let i = 15; i < records.length; i++) {
    const today = records[i];
    const yesterday = records[i - 1];
    dayStartEquity = getDailyEquity(yesterday.prices);

    const currentEquity = getDailyEquity(today.prices);
    const dayPnl = currentEquity - dayStartEquity;
    const dayRoiPct = (dayPnl / dayStartEquity) * 100;

    // Check circuit breaker (-12% day)
    let triggered = false;
    if (dayPnl <= -12.0) {
      triggered = true;
      // Close positions
      for (const h of heldCoins) {
        const exitP = today.prices[h.symbol] || h.entryPrice;
        const pnl = (exitP - h.entryPrice) * h.qty;
        const fee = exitP * h.qty * 0.0007;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
      }
      heldCoins = [];
    }

    dailyMetrics.push({
      date: today.date,
      startEquity: dayStartEquity,
      endEquity: getDailyEquity(today.prices),
      pnl: dayPnl,
      roiPct: dayRoiPct,
      trades: heldCoins.length,
      breakerTriggered: triggered,
    });

    daysSinceRebalance++;
    if (daysSinceRebalance >= rebalanceDays && !triggered) {
      daysSinceRebalance = 0;
      // Close old positions
      for (const h of heldCoins) {
        const exitP = today.prices[h.symbol] || h.entryPrice;
        const pnl = (exitP - h.entryPrice) * h.qty;
        const fee = exitP * h.qty * 0.0007;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
      }
      heldCoins = [];

      // Rank symbols by 14-day momentum
      const past14 = records[i - 14];
      const momentumScores: { symbol: string; returnPct: number }[] = [];
      for (const sym of symbols) {
        if (today.prices[sym] && past14.prices[sym]) {
          const ret = (today.prices[sym] - past14.prices[sym]) / past14.prices[sym];
          momentumScores.push({ symbol: sym, returnPct: ret });
        }
      }
      momentumScores.sort((a, b) => b.returnPct - a.returnPct);

      // Select top 2 coins with positive momentum
      const selected = momentumScores.filter((m) => m.returnPct > 0).slice(0, 2);
      for (const s of selected) {
        const price = today.prices[s.symbol];
        const qty = allocationPerCoin / price;
        const fee = allocationPerCoin * 0.0007;
        cash -= fee;
        heldCoins.push({
          symbol: s.symbol,
          entryPrice: price,
          qty,
        });
      }
    }
  }

  const finalEquity = getDailyEquity(records[records.length - 1].prices);
  const totalDays = dailyMetrics.length;
  const netProfit = finalEquity - initialCapital;
  const totalRoiPct = (netProfit / initialCapital) * 100;
  const meanDailyPnl = netProfit / totalDays;
  const meanDailyRoiPct = totalRoiPct / totalDays;

  let worstDayPnl = 0;
  let worstDayPct = 0;
  let bestDayPnl = 0;
  let peak = initialCapital;
  let maxDD = 0;
  let breakerCount = 0;

  for (const m of dailyMetrics) {
    if (m.pnl < worstDayPnl) worstDayPnl = m.pnl;
    if (m.roiPct < worstDayPct) worstDayPct = m.roiPct;
    if (m.pnl > bestDayPnl) bestDayPnl = m.pnl;
    if (m.endEquity > peak) peak = m.endEquity;
    const dd = ((peak - m.endEquity) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
    if (m.breakerTriggered) breakerCount++;
  }

  const totalTrades = winningTrades + losingTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  return {
    strategyName: 'Multi-Year Macro Momentum Rotation',
    symbol: 'Top 2 of 40 Coins',
    timeframe: '1d',
    startDate: records[15].date,
    endDate: records[records.length - 1].date,
    totalDays,
    initialCapital,
    finalEquity,
    netProfit,
    totalRoiPct,
    meanDailyPnl,
    meanDailyRoiPct,
    annualizedRoiPct: meanDailyRoiPct * 365,
    worstDayPnl,
    worstDayPct,
    bestDayPnl,
    maxDrawdownPct: maxDD,
    totalTrades,
    winRate,
    profitFactor,
    breakerDaysCount: breakerCount,
    meetsTarget: meanDailyRoiPct >= 0.20,
    respectsRiskCap: worstDayPnl >= -12.0,
  };
}

// Helper: Summarize metrics
function summarizeBacktest(
  strategyName: string,
  symbol: string,
  timeframe: string,
  candles: Candle[],
  initialCapital: number,
  finalEquity: number,
  dailyMetrics: DayMetric[],
  winningTrades: number,
  losingTrades: number,
  grossProfit: number,
  grossLoss: number
): BacktestSummary {
  const totalDays = dailyMetrics.length;
  const netProfit = finalEquity - initialCapital;
  const totalRoiPct = (netProfit / initialCapital) * 100;
  const meanDailyPnl = netProfit / totalDays;
  const meanDailyRoiPct = totalRoiPct / totalDays;

  let worstDayPnl = 0;
  let worstDayPct = 0;
  let bestDayPnl = 0;
  let peak = initialCapital;
  let maxDD = 0;
  let breakerCount = 0;

  for (const m of dailyMetrics) {
    if (m.pnl < worstDayPnl) worstDayPnl = m.pnl;
    if (m.roiPct < worstDayPct) worstDayPct = m.roiPct;
    if (m.pnl > bestDayPnl) bestDayPnl = m.pnl;
    if (m.endEquity > peak) peak = m.endEquity;
    const dd = ((peak - m.endEquity) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
    if (m.breakerTriggered) breakerCount++;
  }

  const totalTrades = winningTrades + losingTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  return {
    strategyName,
    symbol,
    timeframe,
    startDate: new Date(candles[0].openTime).toISOString().slice(0, 10),
    endDate: new Date(candles[candles.length - 1].closeTime).toISOString().slice(0, 10),
    totalDays,
    initialCapital,
    finalEquity,
    netProfit,
    totalRoiPct,
    meanDailyPnl,
    meanDailyRoiPct,
    annualizedRoiPct: meanDailyRoiPct * 365,
    worstDayPnl,
    worstDayPct,
    bestDayPnl,
    maxDrawdownPct: maxDD,
    totalTrades,
    winRate,
    profitFactor,
    breakerDaysCount: breakerCount,
    meetsTarget: meanDailyRoiPct >= 0.20,
    respectsRiskCap: worstDayPnl >= -12.0,
  };
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAll() {
  console.log('================================================================');
  console.log('   AGGRESSIVE ROI BACKTEST SUITE (CAPITAL 100u, RISK 12%/DAY)  ');
  console.log('================================================================\n');

  const results: BacktestSummary[] = [];

  // 1. Fetch data
  const sol1h = await getBinanceCandles('SOLUSDT', '1h', 5000); // ~208 days
  const doge1h = await getBinanceCandles('DOGEUSDT', '1h', 5000); // ~208 days
  const sol15m = await getBinanceCandles('SOLUSDT', '15m', 8000); // ~83 days
  const eth15m = await getBinanceCandles('ETHUSDT', '15m', 8000); // ~83 days

  // 2. Run Strategy 1: Grid Maker
  console.log('\n--- Running Candidate 1: Dynamic Grid Maker (1h) ---');
  results.push(runGridMakerBacktest(sol1h, 'SOLUSDT'));
  results.push(runGridMakerBacktest(doge1h, 'DOGEUSDT'));

  // 3. Run Strategy 2: Wick Recovery Sniper
  console.log('\n--- Running Candidate 2: Wick Recovery Sniper (15m) ---');
  results.push(runWickRecoveryBacktest(sol15m, 'SOLUSDT'));
  results.push(runWickRecoveryBacktest(eth15m, 'ETHUSDT'));

  // 4. Run Strategy 3: Range Breakout
  console.log('\n--- Running Candidate 3: Range Breakout (1h) ---');
  results.push(runRangeBreakoutBacktest(sol1h, 'SOLUSDT'));
  results.push(runRangeBreakoutBacktest(doge1h, 'DOGEUSDT'));

  // 5. Run Strategy 4: Macro Momentum (1500 days)
  console.log('\n--- Running Candidate 4: Multi-Year Macro Momentum (1500d) ---');
  const csvPath = path.resolve(
    __dirname,
    '../tests/fixtures/cct-source-projection/daily-source.csv'
  );
  if (fs.existsSync(csvPath)) {
    results.push(runMacroDailyBacktest(csvPath));
  } else {
    console.warn('daily-source.csv not found at', csvPath);
  }

  // --- PRINT FORMATTED TABLE ---
  console.log('\n====================================================================================================');
  console.log('                                  SUMMARY RESULTS TABLE (CAPITAL 100 USDT)                          ');
  console.log('====================================================================================================');
  console.table(
    results.map((r) => ({
      Strategy: r.strategyName.slice(0, 24),
      Symbol: r.symbol,
      Days: r.totalDays,
      'Final ($)': r.finalEquity.toFixed(2),
      'Net PnL ($)': (r.netProfit >= 0 ? '+' : '') + r.netProfit.toFixed(2),
      'ROI/day (%)': (r.meanDailyRoiPct >= 0 ? '+' : '') + r.meanDailyRoiPct.toFixed(3) + '%',
      'Daily ($/d)': (r.meanDailyPnl >= 0 ? '+' : '') + r.meanDailyPnl.toFixed(3),
      'Worst Day ($)': r.worstDayPnl.toFixed(2),
      'Max DD (%)': r.maxDrawdownPct.toFixed(1) + '%',
      'Win Rate': r.winRate.toFixed(1) + '%',
      'Breakers': r.breakerDaysCount,
      'Target >= 0.2%': r.meetsTarget ? 'PASS' : 'FAIL',
      'Risk <= 12u': r.respectsRiskCap ? 'PASS' : 'FAIL',
    }))
  );

  // Save detailed JSON
  const outPath = path.join(CACHE_DIR, 'aggressive_backtest_results.json');
}

if (require.main === module) {
  runAll().catch(console.error);
}
