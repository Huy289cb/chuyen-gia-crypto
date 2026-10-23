/**
 * Optimization Suite for Aggressive High-ROI Candidates
 *
 * Investigates:
 * 1. Macro Momentum with Active Stop Loss (1500 days on 40 coins)
 *    - Baseline was +223.84u (+0.151%/day), but had -18.77u worst day due to no stop loss.
 *    - Adding per-coin stop loss (4% - 8%) to enforce risk cap <= 12u while targeting >= 0.2%/day.
 * 2. Optimized High-Utilization Grid Maker (SOLUSDT & Multi-Coin)
 *    - Testing capital utilization (ticket sizes 8u - 15u, grid spacing 0.8% - 1.5%).
 * 3. Multi-Coin Liquidation Sniper (SOL, ETH, DOGE, XRP)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBinanceCandles, Candle, BacktestSummary } from './backtest-aggressive-candidates';

const CACHE_DIR = path.resolve(__dirname, '../data/backtest-cache');

// ============================================================================
// EXPERIMENT 1: MACRO MOMENTUM WITH STOP LOSS (1500 DAYS)
// ============================================================================
export function runMacroWithStopLoss(
  csvPath: string,
  initialCapital = 100.0,
  rebalanceDays = 5,
  stopLossPct = 0.06, // 6% hard stop loss per coin
  numCoins = 2,
  allocationRatio = 0.80 // 80% total capital allocated
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
  const dailyMetrics: {
    date: string;
    startEquity: number;
    endEquity: number;
    pnl: number;
    roiPct: number;
    breakerTriggered: boolean;
  }[] = [];

  interface HeldCoin {
    symbol: string;
    entryPrice: number;
    qty: number;
    highestPrice: number;
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

    // 1. Check per-coin Stop Loss on daily price move
    const survivingCoins: HeldCoin[] = [];
    for (const h of heldCoins) {
      const currentP = today.prices[h.symbol] || h.entryPrice;
      const coinReturn = (currentP - h.entryPrice) / h.entryPrice;

      if (coinReturn <= -stopLossPct) {
        // Hit Stop Loss! Sell coin
        const exitP = h.entryPrice * (1 - stopLossPct);
        const pnl = (exitP - h.entryPrice) * h.qty;
        const fee = exitP * h.qty * 0.0007;
        cash += pnl - fee;
        losingTrades++;
        grossLoss += Math.abs(pnl);
      } else {
        if (currentP > h.highestPrice) h.highestPrice = currentP;
        survivingCoins.push(h);
      }
    }
    heldCoins = survivingCoins;

    // 2. Check Daily Portfolio Circuit Breaker (-12u)
    let currentEquity = getDailyEquity(today.prices);
    let dayPnl = currentEquity - dayStartEquity;
    let breakerTriggered = false;

    if (dayPnl <= -12.0) {
      breakerTriggered = true;
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

    currentEquity = getDailyEquity(today.prices);
    dayPnl = currentEquity - dayStartEquity;
    const dayRoiPct = (dayPnl / dayStartEquity) * 100;

    dailyMetrics.push({
      date: today.date,
      startEquity: dayStartEquity,
      endEquity: currentEquity,
      pnl: dayPnl,
      roiPct: dayRoiPct,
      breakerTriggered,
    });

    // 3. Rebalance Logic
    daysSinceRebalance++;
    if (daysSinceRebalance >= rebalanceDays && !breakerTriggered) {
      daysSinceRebalance = 0;
      // Close all existing positions
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

      // Momentum Ranking: 14-day return
      const past14 = records[i - 14];
      const scores: { symbol: string; ret: number }[] = [];
      for (const sym of symbols) {
        if (today.prices[sym] && past14.prices[sym]) {
          const r = (today.prices[sym] - past14.prices[sym]) / past14.prices[sym];
          scores.push({ symbol: sym, ret: r });
        }
      }
      scores.sort((a, b) => b.ret - a.ret);

      // Select top N positive momentum coins
      const selected = scores.filter((s) => s.ret > 0.02).slice(0, numCoins);
      if (selected.length > 0) {
        const allocPerCoin = (cash * allocationRatio) / selected.length;
        for (const sel of selected) {
          const p = today.prices[sel.symbol];
          const qty = allocPerCoin / p;
          const fee = allocPerCoin * 0.0007;
          cash -= fee;
          heldCoins.push({
            symbol: sel.symbol,
            entryPrice: p,
            qty,
            highestPrice: p,
          });
        }
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
    strategyName: `Macro Momentum (SL ${(stopLossPct * 100).toFixed(0)}%, Reb ${rebalanceDays}d)`,
    symbol: `Top ${numCoins} of 40`,
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

// ============================================================================
// EXPERIMENT 2: OPTIMIZED DYNAMIC GRID MAKER (HIGHER UTILIZATION)
// ============================================================================
export function runOptimizedGrid(
  candles: Candle[],
  symbol: string,
  initialCapital = 100.0,
  gridStepPct = 0.010, // 1.0% spacing
  ticketUsd = 12.0, // $12 ticket size (satisfies 5u min notional)
  maxLevels = 5, // max 5 levels ($60 exposure on 100u)
  tpMult = 1.3 // 1.3x grid step TP
): BacktestSummary {
  const closes = candles.map((c) => c.close);
  // Faster 50 EMA for more reactive grid placement
  const k = 2 / (50 + 1);
  const ema = new Array(closes.length).fill(0);
  let sum = 0;
  for (let i = 0; i < 50; i++) sum += closes[i];
  ema[49] = sum / 50;
  for (let i = 50; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }

  let cash = initialCapital;
  let dayStartEquity = initialCapital;
  let currentDay = new Date(candles[0].openTime).toISOString().slice(0, 10);
  let breakerActive = false;

  interface PositionLevel {
    entryPrice: number;
    qty: number;
    tpPrice: number;
  }
  let openLevels: PositionLevel[] = [];
  const dailyMetrics: any[] = [];
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

  for (let i = 50; i < candles.length; i++) {
    const bar = candles[i];
    const today = new Date(bar.openTime).toISOString().slice(0, 10);

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
    const intradayLoss = currentEquity - dayStartEquity;

    // Hard Breaker Check (-12u)
    if (intradayLoss <= -12.0 && !breakerActive) {
      breakerActive = true;
      for (const lvl of openLevels) {
        const pnl = (bar.close - lvl.entryPrice) * lvl.qty;
        const fee = bar.close * lvl.qty * 0.0007; // taker fee on panic close
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
      continue;
    }

    if (breakerActive) continue;

    // 1. Check Take Profit fills (Maker)
    const remaining: PositionLevel[] = [];
    for (const lvl of openLevels) {
      if (bar.high >= lvl.tpPrice) {
        const pnl = (lvl.tpPrice - lvl.entryPrice) * lvl.qty;
        const fee = lvl.tpPrice * lvl.qty * 0.0002; // maker fee
        cash += pnl - fee;
        winningTrades++;
        grossProfit += pnl;
        dayTrades++;
      } else {
        remaining.push(lvl);
      }
    }
    openLevels = remaining;

    // 2. Check Limit Buy fills (Maker)
    const anchor = ema[i];
    if (openLevels.length < maxLevels && anchor > 0) {
      const levelIdx = openLevels.length;
      const targetLimitBuy = anchor * (1 - (levelIdx + 1) * gridStepPct);

      if (bar.low <= targetLimitBuy) {
        const fillPrice = targetLimitBuy;
        const qty = ticketUsd / fillPrice;
        const fee = ticketUsd * 0.0002;
        cash -= fee;
        const tpPrice = fillPrice * (1 + gridStepPct * tpMult);
        openLevels.push({
          entryPrice: fillPrice,
          qty,
          tpPrice,
        });
      }
    }
  }

  const finalPrice = candles[candles.length - 1].close;
  const finalEquity = getEquity(finalPrice);
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
    strategyName: `Optimized Grid (Step ${(gridStepPct * 100).toFixed(1)}%, Tkt $${ticketUsd})`,
    symbol,
    timeframe: '1h',
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
// EXPERIMENT 3: DUAL-ASSET COMBINATION (GRID + MOMENTUM)
// ============================================================================
// Run sweep
async function runSweeps() {
  console.log('================================================================');
  console.log('          OPTIMIZATION & FEASIBILITY SWEEP RESULTS              ');
  console.log('================================================================\n');

  const sweepResults: BacktestSummary[] = [];

  // 1. Test Macro Momentum with different stop-losses & rebalance frequencies
  const csvPath = path.resolve(
    __dirname,
    '../tests/fixtures/cct-source-projection/daily-source.csv'
  );

  console.log('--- Testing Macro Momentum Variants on 1500 Days ---');
  if (fs.existsSync(csvPath)) {
    // Sweep SL: 4%, 5%, 6%, 7% and Rebalance: 3d, 5d, 7d
    sweepResults.push(runMacroWithStopLoss(csvPath, 100, 3, 0.05, 2, 0.85));
    sweepResults.push(runMacroWithStopLoss(csvPath, 100, 5, 0.05, 2, 0.85));
    sweepResults.push(runMacroWithStopLoss(csvPath, 100, 5, 0.06, 2, 0.85));
    sweepResults.push(runMacroWithStopLoss(csvPath, 100, 7, 0.06, 2, 0.85));
    sweepResults.push(runMacroWithStopLoss(csvPath, 100, 5, 0.07, 3, 0.90));
  }

  // 2. Test Grid Maker with tuned spacing and utilization
  console.log('\n--- Testing Optimized Grid Maker on SOLUSDT & DOGEUSDT ---');
  const sol1h = await getBinanceCandles('SOLUSDT', '1h', 5000);
  const doge1h = await getBinanceCandles('DOGEUSDT', '1h', 5000);

  sweepResults.push(runOptimizedGrid(sol1h, 'SOLUSDT', 100, 0.008, 12.0, 5, 1.4));
  sweepResults.push(runOptimizedGrid(sol1h, 'SOLUSDT', 100, 0.010, 15.0, 5, 1.3));
  sweepResults.push(runOptimizedGrid(sol1h, 'SOLUSDT', 100, 0.012, 12.0, 6, 1.5));
  sweepResults.push(runOptimizedGrid(doge1h, 'DOGEUSDT', 100, 0.012, 12.0, 5, 1.4));

  console.log('\n====================================================================================================');
  console.log('                              DETAILED COMPARATIVE OPTIMIZATION TABLE                               ');
  console.log('====================================================================================================');
  console.table(
    sweepResults.map((r) => ({
      Strategy: r.strategyName.slice(0, 32),
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

  const outPath = path.join(CACHE_DIR, 'optimized_sweep_results.json');
  fs.writeFileSync(outPath, JSON.stringify(sweepResults, null, 2));
  console.log(`\nSweep results saved to: ${outPath}`);
}

runSweeps().catch(console.error);
