/**
 * Hourly Multi-Asset Momentum with True Intraday High/Low Stop Loss
 *
 * Uses real Binance Futures 1h candles (5,000 bars ~ 208 days) for:
 * [BTCUSDT, ETHUSDT, SOLUSDT, DOGEUSDT, XRPUSDT]
 *
 * Execution Rules:
 * - Real OHLC: If bar.low <= slPrice, position exits at bar.low (or slPrice with adverse slip) INTRADAY,
 *   NOT waiting for the day to end!
 * - Allocation: $35 x 2 coins ($70 total position on $100 capital).
 * - Real Taker fee: 0.05% + 0.02% slippage = 0.07% each way.
 * - Daily Circuit Breaker: 12.0 USDT.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBinanceCandles, Candle, BacktestSummary } from './backtest-aggressive-candidates';

async function runHourlyMomentum() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'];
  console.log('Loading 5,000 1h candles for B5 basket from Binance...');

  const candleMap: Record<string, Candle[]> = {};
  for (const s of symbols) {
    candleMap[s] = await getBinanceCandles(s, '1h', 5000);
  }

  // Align timestamps
  const minLen = Math.min(...symbols.map((s) => candleMap[s].length));
  console.log(`Aligned 1h bars count: ${minLen}`);

  let cash = 100.0;
  let dayStartEquity = 100.0;
  let currentDay = new Date(candleMap['BTCUSDT'][0].openTime).toISOString().slice(0, 10);
  let breakerActive = false;

  const allocPerCoin = 35.0; // $35 each for top 2 coins
  const stopLossPct = 0.05; // 5% stop loss
  const rebalanceHours = 72; // 3 days = 72 hours
  const momentumLookback = 336; // 14 days = 336 hours

  interface Pos {
    symbol: string;
    entryPrice: number;
    qty: number;
    slPrice: number;
  }
  let openPositions: Pos[] = [];
  let hoursSinceRebalance = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let breakerCount = 0;
  let worstDayPnl = 0;

  const dailyPnLs: { date: string; pnl: number; equity: number }[] = [];

  function getEquity(barIndex: number): number {
    let unrl = 0;
    for (const p of openPositions) {
      const currentPrice = candleMap[p.symbol][barIndex].close;
      unrl += (currentPrice - p.entryPrice) * p.qty;
    }
    return cash + unrl;
  }

  for (let i = momentumLookback; i < minLen; i++) {
    const timestamp = candleMap['BTCUSDT'][i].openTime;
    const today = new Date(timestamp).toISOString().slice(0, 10);

    // New day tracking
    if (today !== currentDay) {
      const endEq = getEquity(i - 1);
      const dayPnl = endEq - dayStartEquity;
      dailyPnLs.push({ date: currentDay, pnl: dayPnl, equity: endEq });
      if (dayPnl < worstDayPnl) worstDayPnl = dayPnl;

      currentDay = today;
      dayStartEquity = endEq;
      breakerActive = false;
    }

    // 1. Check Intraday High/Low Stop Loss for open positions
    const surviving: Pos[] = [];
    for (const p of openPositions) {
      const bar = candleMap[p.symbol][i];
      if (bar.low <= p.slPrice) {
        // Intraday stop triggered!
        // Slipped exit price: min of slPrice or bar.low
        const exitPrice = Math.min(p.slPrice, bar.open * 0.99); // realistic stop slip
        const pnl = (exitPrice - p.entryPrice) * p.qty;
        const fee = exitPrice * p.qty * 0.0007;
        cash += pnl - fee;
        losingTrades++;
        grossLoss += Math.abs(pnl);
      } else {
        surviving.push(p);
      }
    }
    openPositions = surviving;

    // 2. Check Daily Circuit Breaker (-12u)
    const currentEquity = getEquity(i);
    const dayPnlSoFar = currentEquity - dayStartEquity;
    if (dayPnlSoFar <= -12.0 && !breakerActive) {
      breakerActive = true;
      breakerCount++;
      for (const p of openPositions) {
        const bar = candleMap[p.symbol][i];
        const exitPrice = bar.close;
        const pnl = (exitPrice - p.entryPrice) * p.qty;
        const fee = exitPrice * p.qty * 0.0007;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
      }
      openPositions = [];
      continue;
    }

    if (breakerActive) continue;

    // 3. Rebalance every 72 hours (3 days)
    hoursSinceRebalance++;
    if (hoursSinceRebalance >= rebalanceHours) {
      hoursSinceRebalance = 0;

      // Close all existing
      for (const p of openPositions) {
        const bar = candleMap[p.symbol][i];
        const exitPrice = bar.close;
        const pnl = (exitPrice - p.entryPrice) * p.qty;
        const fee = exitPrice * p.qty * 0.0007;
        cash += pnl - fee;
        if (pnl > 0) {
          winningTrades++;
          grossProfit += pnl;
        } else {
          losingTrades++;
          grossLoss += Math.abs(pnl);
        }
      }
      openPositions = [];

      // Calculate 14-day momentum (336 bars)
      const scores: { symbol: string; ret: number }[] = [];
      for (const s of symbols) {
        const curP = candleMap[s][i].close;
        const pastP = candleMap[s][i - momentumLookback].close;
        const ret = (curP - pastP) / pastP;
        scores.push({ symbol: s, ret });
      }
      scores.sort((a, b) => b.ret - a.ret);

      // Select top 2 positive momentum coins
      const top2 = scores.filter((s) => s.ret > 0.01).slice(0, 2);
      for (const sel of top2) {
        const entryPrice = candleMap[sel.symbol][i].close;
        const qty = allocPerCoin / entryPrice;
        const slPrice = entryPrice * (1 - stopLossPct);
        const fee = allocPerCoin * 0.0007;
        cash -= fee;
        openPositions.push({
          symbol: sel.symbol,
          entryPrice,
          qty,
          slPrice,
        });
      }
    }
  }

  const finalEquity = getEquity(minLen - 1);
  const totalDays = dailyPnLs.length;
  const netProfit = finalEquity - 100.0;
  const meanDailyPnl = netProfit / totalDays;
  const meanDailyRoi = (netProfit / 100.0) / totalDays * 100;

  console.log('\n========================================================================================');
  console.log('       HOURLY REAL CANDLE MOMENTUM RESULTS (INTRADAY STOPS ON BINANCE OHLCV)           ');
  console.log('========================================================================================');
  console.log(`Period: ${dailyPnLs[0].date} to ${dailyPnLs[dailyPnLs.length - 1].date} (${totalDays} days)`);
  console.log(`Initial Capital: $100.00`);
  console.log(`Final Equity: $${finalEquity.toFixed(2)}`);
  console.log(`Net Profit: ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} USDT`);
  console.log(`Mean Daily PnL: ${meanDailyPnl >= 0 ? '+' : ''}${meanDailyPnl.toFixed(4)} USDT/day (+${meanDailyRoi.toFixed(3)}%/day)`);
  console.log(`Annualized ROI: +${(meanDailyRoi * 365).toFixed(1)}%/year`);
  console.log(`Worst Day: ${worstDayPnl.toFixed(2)} USDT`);
  console.log(`Circuit Breakers Triggered: ${breakerCount}`);
  console.log(`Total Trades: ${winningTrades + losingTrades} (Win Rate: ${((winningTrades / (winningTrades + losingTrades)) * 100).toFixed(1)}%)`);
  console.log(`Profit Factor: ${(grossProfit / (grossLoss || 1)).toFixed(2)}`);
}

runHourlyMomentum().catch(console.error);
