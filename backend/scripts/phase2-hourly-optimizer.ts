/**
 * PHASE 2 HOURLY MOMENTUM OPTIMIZER & AUDITOR
 *
 * Systematic sweep across:
 * - Allocations: $30, $35, $40, $45 per coin ($60 to $90 total exposure on $100 capital)
 * - Stop Losses: 4%, 5%, 6%
 * - Lookbacks: 168h (7d), 240h (10d), 336h (14d)
 * - Rebalance periods: 24h (1d), 48h (2d), 72h (3d)
 * - Universe: B5 liquid futures (BTC, ETH, SOL, DOGE, XRP)
 *
 * Enforces:
 * - True intraday High/Low stops with 1% adverse gap slippage.
 * - 0.07% taker fee each way.
 * - Daily circuit breaker <= -12.0 USDT.
 * - Zero lookahead, causal bar execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBinanceCandles, Candle } from './backtest-aggressive-candidates';

interface SimResult {
  alloc: number;
  slPct: number;
  rebHours: number;
  lbHours: number;
  netPnl: number;
  meanDailyPnl: number;
  annualizedRoi: number;
  worstDayPnl: number;
  breakerCount: number;
  winRate: number;
  profitFactor: number;
  trades: number;
}

export async function runSweep() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'];
  console.log('Loading 5,000 1h candles for B5 basket from cache/Binance...');

  const candleMap: Record<string, Candle[]> = {};
  for (const s of symbols) {
    candleMap[s] = await getBinanceCandles(s, '1h', 5000);
  }

  const minLen = Math.min(...symbols.map((s) => candleMap[s].length));
  console.log(`Aligned bars: ${minLen} (~${Math.floor(minLen / 24)} days)`);

  function simulate(
    allocPerCoin: number,
    stopLossPct: number,
    rebalanceHours: number,
    momentumLookback: number
  ): SimResult {
    let cash = 100.0;
    let dayStartEquity = 100.0;
    let currentDay = new Date(candleMap['BTCUSDT'][momentumLookback].openTime).toISOString().slice(0, 10);
    let breakerActive = false;

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
    const dailyPnLs: number[] = [];

    function getEquity(idx: number): number {
      let unrl = 0;
      for (const p of openPositions) {
        const curPrice = candleMap[p.symbol][idx].close;
        unrl += (curPrice - p.entryPrice) * p.qty;
      }
      return cash + unrl;
    }

    for (let i = momentumLookback; i < minLen; i++) {
      const today = new Date(candleMap['BTCUSDT'][i].openTime).toISOString().slice(0, 10);

      // Day roll
      if (today !== currentDay) {
        const endEq = getEquity(i - 1);
        const dayPnl = endEq - dayStartEquity;
        dailyPnLs.push(dayPnl);
        if (dayPnl < worstDayPnl) worstDayPnl = dayPnl;
        currentDay = today;
        dayStartEquity = endEq;
        breakerActive = false;
      }

      // 1. Evaluate Intraday Stops
      const surviving: Pos[] = [];
      for (const p of openPositions) {
        const bar = candleMap[p.symbol][i];
        if (bar.low <= p.slPrice) {
          // Intraday stop triggered! Realistic exit at min of slPrice or bar.open*0.99
          const exitPrice = Math.min(p.slPrice, bar.open * 0.99);
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
      const curEq = getEquity(i);
      const dayPnlSoFar = curEq - dayStartEquity;
      if (dayPnlSoFar <= -12.0 && !breakerActive) {
        breakerActive = true;
        breakerCount++;
        for (const p of openPositions) {
          const bar = candleMap[p.symbol][i];
          const exitPrice = bar.close;
          const pnl = (exitPrice - p.entryPrice) * p.qty;
          const fee = exitPrice * p.qty * 0.0007;
          cash += pnl - fee;
          if (pnl > 0) { winningTrades++; grossProfit += pnl; }
          else { losingTrades++; grossLoss += Math.abs(pnl); }
        }
        openPositions = [];
        continue;
      }

      if (breakerActive) continue;

      // 3. Rebalance cycle
      hoursSinceRebalance++;
      if (hoursSinceRebalance >= rebalanceHours) {
        hoursSinceRebalance = 0;
        // Close existing
        for (const p of openPositions) {
          const bar = candleMap[p.symbol][i];
          const exitPrice = bar.close;
          const pnl = (exitPrice - p.entryPrice) * p.qty;
          const fee = exitPrice * p.qty * 0.0007;
          cash += pnl - fee;
          if (pnl > 0) { winningTrades++; grossProfit += pnl; }
          else { losingTrades++; grossLoss += Math.abs(pnl); }
        }
        openPositions = [];

        // Rank momentum over lookback
        const scores: { symbol: string; ret: number }[] = [];
        for (const s of symbols) {
          const curP = candleMap[s][i].close;
          const pastP = candleMap[s][i - momentumLookback].close;
          const ret = (curP - pastP) / pastP;
          scores.push({ symbol: s, ret });
        }
        scores.sort((a, b) => b.ret - a.ret);

        const top2 = scores.filter((s) => s.ret > 0.01).slice(0, 2);
        for (const sel of top2) {
          const entryPrice = candleMap[sel.symbol][i].close;
          const qty = allocPerCoin / entryPrice;
          const slPrice = entryPrice * (1 - stopLossPct);
          const fee = allocPerCoin * 0.0007;
          cash -= fee;
          openPositions.push({ symbol: sel.symbol, entryPrice, qty, slPrice });
        }
      }
    }

    const finalEq = getEquity(minLen - 1);
    const totalDays = dailyPnLs.length;
    const netPnl = finalEq - 100.0;
    const meanDailyPnl = netPnl / totalDays;
    const annualizedRoi = (netPnl / 100.0) / totalDays * 365 * 100;
    const winRate = (winningTrades / ((winningTrades + losingTrades) || 1)) * 100;
    const profitFactor = grossProfit / (grossLoss || 1);

    return {
      alloc: allocPerCoin,
      slPct: stopLossPct,
      rebHours: rebalanceHours,
      lbHours: momentumLookback,
      netPnl,
      meanDailyPnl,
      annualizedRoi,
      worstDayPnl,
      breakerCount,
      winRate,
      profitFactor,
      trades: winningTrades + losingTrades,
    };
  }

  console.log('\nRunning Hourly Parameter Sweep...');
  const results: SimResult[] = [];
  for (const alloc of [30.0, 35.0, 40.0, 45.0]) {
    for (const sl of [0.04, 0.05, 0.06]) {
      for (const reb of [24, 48, 72]) {
        for (const lb of [168, 240, 336]) {
          const res = simulate(alloc, sl, reb, lb);
          if (res.breakerCount === 0 && res.worstDayPnl >= -12.0) {
            results.push(res);
          }
        }
      }
    }
  }

  results.sort((a, b) => b.meanDailyPnl - a.meanDailyPnl);
  console.log(`\n========================================================================================`);
  console.log(`      TOP 20 ZERO-BREACH HOURLY MOMENTUM CONFIGURATIONS (REAL BINANCE 1h OHLCV)        `);
  console.log(`========================================================================================`);
  for (const r of results.slice(0, 20)) {
    console.log(
      `Alloc=$${r.alloc.toFixed(0)}x2 ($${(r.alloc * 2).toFixed(0)}) | Reb=${r.rebHours}h (${r.rebHours / 24}d) | LB=${r.lbHours}h (${(r.lbHours / 24).toFixed(0)}d) | SL=${(r.slPct * 100).toFixed(0)}% => ` +
      `Net=+${r.netPnl.toFixed(2)}u | Mean=+${r.meanDailyPnl.toFixed(4)}u/d (+${(r.meanDailyPnl * 100 / 100).toFixed(3)}%/d, +${r.annualizedRoi.toFixed(1)}%/yr) | ` +
      `Worst=${r.worstDayPnl.toFixed(2)}u | Breakers=${r.breakerCount} | PF=${r.profitFactor.toFixed(2)} | WR=${r.winRate.toFixed(1)}%`
    );
  }
}

runSweep().catch(console.error);
