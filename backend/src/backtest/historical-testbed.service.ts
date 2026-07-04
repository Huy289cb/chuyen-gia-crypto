/**
 * Walk-forward historical testbed — signal gate + HTF guard + rule-based SL/TP (no LLM).
 */

import { SignalGateService } from '../services/signal-gate.service';
import { getRiskPolicy } from '../config/risk-policy';
import { getV3EntryTfPriorityRank, getV3SignalGateTimeframes } from '../config/v3-schedulers';
import {
  evaluateHtfTrendRequirement,
  getSignalGateAllowedRegimes,
  getV3HtfTrendAlt,
  getV3LtfAlignRegimeHtf,
  getV3RequireHtfTrend,
  isRangeEntryBlocked,
} from '../config/v3-entry-policy';
import { compareSignalGateForEntry } from '../utils/signal-gate-ranking';
import { computePolicyCompliantStopAndTarget } from '../utils/trade-levels';
import { computeRegimeEvidence, type MarketRegime } from '../analyzers/market-regime.analyzer';
import { getSignalGateWindows } from '../config/signal-gate-windows';
import { candlesUpTo, loadBacktestCandles } from './candle-loader';
import { inferSetupTradeSide } from './signal-direction';
import { checkBarForExit, closePositionAt, simulatePositionExit, type OpenSimPosition } from './position-simulator';
import type { BacktestBlockStats, BacktestRunOptions, BacktestRunResult, BacktestTrade } from './types';

function slBucket(pct: number): string {
  if (pct < 0.35) return '<0.35%';
  if (pct < 0.4) return '0.35-0.40%';
  if (pct < 0.5) return '0.40-0.50%';
  if (pct < 0.7) return '0.50-0.70%';
  return '>=0.70%';
}

function buildSlBuckets(trades: BacktestTrade[]) {
  const buckets = new Map<string, { n: number; wins: number; losses: number; netPnl: number }>();
  for (const t of trades) {
    const b = slBucket(t.slDistancePct);
    const row = buckets.get(b) ?? { n: 0, wins: 0, losses: 0, netPnl: 0 };
    row.n += 1;
    row.netPnl += t.pnlUsd;
    if (t.pnlUsd > 0) row.wins += 1;
    else if (t.pnlUsd < 0) row.losses += 1;
    buckets.set(b, row);
  }
  return [...buckets.entries()].map(([bucket, v]) => ({ bucket, ...v }));
}

function maxLossStreak(trades: BacktestTrade[]): number {
  let max = 0;
  let cur = 0;
  for (const t of trades) {
    if (t.pnlUsd < 0) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

export async function runHistoricalTestbed(
  options: BacktestRunOptions = {}
): Promise<BacktestRunResult> {
  const symbol = (options.symbol ?? 'BTC').toUpperCase();
  const weeks = options.weeks ?? 3;
  const policy = getRiskPolicy();
  const minSlPct = options.minSlPct ?? policy.minSlDistancePercent;
  const minRr = options.minRr ?? 2;
  const notionalUsd = options.notionalUsd ?? 2000;
  const feePctPerSide = options.feePctPerSide ?? 0.0004;
  const timeframes = [...getV3SignalGateTimeframes()];
  const entryRank = getV3EntryTfPriorityRank();

  const loaded = await loadBacktestCandles({
    symbol,
    weeks,
    timeframes,
    startDate: options.startDate,
    endDate: options.endDate,
    extraWarmupBars5m: options.warmupBars5m ?? 150,
  });

  const candles5m = loaded.byTf['5m'] ?? [];
  const periodStartTs = loaded.period.start.getTime();
  const walkBars = candles5m.filter((c) => c.timestamp >= periodStartTs);

  const gate = new SignalGateService({
    minGrade: policy.minSignalGrade,
    minConfidence: policy.minSignalConfidence,
    allowedRegimes: getSignalGateAllowedRegimes(),
    enableDuplicateFilter: false,
  });

  const htfTf = getV3LtfAlignRegimeHtf() ?? getV3RequireHtfTrend() ?? '1h';
  const altTf = getV3HtfTrendAlt();
  const blocks: BacktestBlockStats = {
    signal_gate: 0,
    regime: 0,
    htf: 0,
    no_direction: 0,
    open_position: 0,
    duplicate_signal: 0,
  };

  const tradedSignals = new Set<string>();

  const trades: BacktestTrade[] = [];
  let signalsPassed = 0;
  let open: OpenSimPosition | null = null;
  let tradeId = 0;

  const getHtfRegime = (tf: string, ts: number): MarketRegime | null => {
    const slice = candlesUpTo(loaded.byTf[tf] ?? [], ts);
    if (slice.length < 50) return null;
    const w = getSignalGateWindows(tf);
    return computeRegimeEvidence(slice, { regimeBars: w.regimeBars, timeframe: tf }).regime;
  };

  for (let barIdx = 0; barIdx < walkBars.length; barIdx++) {
    const bar = walkBars[barIdx];
    const ts = bar.timestamp;

    if (open) {
      if (barIdx > open.entryBarIndex) {
        const hit = checkBarForExit(open, bar);
        if (hit) {
          trades.push({
            id: ++tradeId,
            ...closePositionAt(
              open,
              ts,
              hit.closePrice,
              hit.closeReason,
              barIdx - open.entryBarIndex
            ),
          });
          open = null;
        } else {
          blocks.open_position += 1;
          continue;
        }
      } else {
        blocks.open_position += 1;
        continue;
      }
    }

    const htfRegime1h = getHtfRegime(htfTf, ts);
    const htfRegimeAlt = altTf ? getHtfRegime(altTf, ts) : undefined;

    const evaluations: Array<{ timeframe: string; result: Awaited<ReturnType<SignalGateService['evaluate']>>; candles: typeof walkBars }> = [];

    for (const tf of timeframes) {
      const slice = candlesUpTo(loaded.byTf[tf] ?? [], ts);
      if (slice.length < 50) continue;
      const result = await gate.evaluate({
        candles: slice,
        symbol,
        timeframe: tf,
        htfRegime: tf !== htfTf ? htfRegime1h : undefined,
      });
      evaluations.push({ timeframe: tf, result, candles: slice });
    }

    const passing = evaluations.filter((e) => e.result.pass);
    if (passing.length === 0) {
      blocks.signal_gate += 1;
      continue;
    }

    signalsPassed += 1;
    passing.sort((a, b) =>
      compareSignalGateForEntry(
        { timeframe: a.timeframe, result: a.result },
        { timeframe: b.timeframe, result: b.result }
      )
    );

    const pick = passing[0];
    const signalBarTs = pick.result.setupResult.evidence.lastCandleTime ?? ts;
    const signalKey = `${pick.timeframe}:${signalBarTs}`;
    if (tradedSignals.has(signalKey)) {
      blocks.duplicate_signal += 1;
      continue;
    }

    const gateRegime = pick.result.gateRegime ?? pick.result.setupResult.regime;
    if (isRangeEntryBlocked(gateRegime)) {
      blocks.regime += 1;
      continue;
    }

    const htfCheck = evaluateHtfTrendRequirement({
      entryTimeframe: pick.timeframe,
      primaryTf: htfTf,
      primaryRegime: htfRegime1h,
      altTf: altTf ?? undefined,
      altRegime: htfRegimeAlt,
    });
    if (!htfCheck.pass) {
      blocks.htf += 1;
      continue;
    }

    const side = inferSetupTradeSide(pick.result.setupResult, pick.timeframe, pick.candles);
    if (!side) {
      blocks.no_direction += 1;
      continue;
    }

    const action = side === 'long' ? 'buy' : 'sell';
    const entry = bar.close;
    const levels = computePolicyCompliantStopAndTarget({
      action,
      entry,
      minSlPct,
      minRr,
    });
    if (!levels) continue;

    const slDistancePct = (Math.abs(entry - levels.stopLoss) / entry) * 100;
    const rr = Math.abs(levels.takeProfit - entry) / Math.abs(entry - levels.stopLoss);

    open = {
      id: tradeId + 1,
      side,
      timeframe: pick.timeframe,
      playbookKey: pick.result.setupResult.playbookKey,
      grade: pick.result.setupResult.grade,
      entryTime: ts,
      entryPrice: entry,
      stopLoss: levels.stopLoss,
      takeProfit: levels.takeProfit,
      slDistancePct,
      rr,
      notionalUsd,
      feePctPerSide,
      entryBarIndex: barIdx,
    };
    tradedSignals.add(signalKey);
  }

  if (open) {
    const closed = simulatePositionExit(open, walkBars, open.entryBarIndex + 1);
    if (closed) trades.push({ id: ++tradeId, ...closed });
  }

  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const losses = trades.filter((t) => t.pnlUsd < 0).length;
  const grossPnl = trades.reduce((s, t) => s + t.pnlUsd + notionalUsd * feePctPerSide * 2, 0);
  const fees = trades.length * notionalUsd * feePctPerSide * 2;
  const netPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);

  return {
    symbol,
    period: {
      start: loaded.period.start.toISOString(),
      end: loaded.period.end.toISOString(),
      weeks,
    },
    config: {
      minSlPct,
      minRr,
      notionalUsd,
      feePctPerSide,
      timeframes,
      entryTfPriority: Object.entries(entryRank)
        .sort((a, b) => a[1] - b[1])
        .map(([tf]) => tf),
    },
    summary: {
      steps: walkBars.length,
      signalsPassed,
      entries: trades.length,
      wins,
      losses,
      winRate: trades.length ? wins / trades.length : 0,
      netPnlUsd: netPnl,
      grossPnlUsd: grossPnl,
      feesUsd: fees,
      avgSlPct: trades.length
        ? trades.reduce((s, t) => s + t.slDistancePct, 0) / trades.length
        : 0,
      avgBarsHeld: trades.length
        ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length
        : 0,
      maxConsecutiveLosses: maxLossStreak(trades),
    },
    blocks,
    slBuckets: buildSlBuckets(trades),
    trades,
  };
}

/** Compare multiple min-SL settings on the same period (offline sweep). */
export async function runHistoricalTestbedSlSweep(
  slPcts: number[],
  baseOptions: BacktestRunOptions = {}
): Promise<BacktestRunResult[]> {
  const results: BacktestRunResult[] = [];
  for (const minSlPct of slPcts) {
    results.push(await runHistoricalTestbed({ ...baseOptions, minSlPct }));
  }
  return results;
}

export function formatTestbedReport(result: BacktestRunResult): string {
  const s = result.summary;
  const lines = [
    `=== Historical Testbed: ${result.symbol} ===`,
    `Period: ${result.period.start.slice(0, 10)} → ${result.period.end.slice(0, 10)} (~${result.period.weeks}w)`,
    `Config: minSL=${(result.config.minSlPct * 100).toFixed(2)}% RR>=${result.config.minRr} notional=$${result.config.notionalUsd}`,
    `TFs: ${result.config.timeframes.join(', ')} | entry priority: ${result.config.entryTfPriority.join(' → ')}`,
    '',
    `Steps (5m bars): ${s.steps}`,
    `Gate pass cycles: ${s.signalsPassed} → entries: ${s.entries}`,
    `W/L: ${s.wins}/${s.losses} (${(s.winRate * 100).toFixed(1)}% WR)`,
    `Net PnL: $${s.netPnlUsd.toFixed(2)} (fees ~$${s.feesUsd.toFixed(2)})`,
    `Avg SL: ${s.avgSlPct.toFixed(3)}% | avg hold: ${s.avgBarsHeld.toFixed(1)} bars (5m)`,
    `Max loss streak: ${s.maxConsecutiveLosses}`,
    '',
    'Blocks:',
    `  signal_gate: ${result.blocks.signal_gate}`,
    `  regime: ${result.blocks.regime}`,
    `  htf: ${result.blocks.htf}`,
    `  no_direction: ${result.blocks.no_direction}`,
    `  duplicate_signal: ${result.blocks.duplicate_signal}`,
    `  skipped_open_position: ${result.blocks.open_position}`,
    '',
    'SL buckets:',
    ...result.slBuckets.map(
      (b) => `  ${b.bucket}: n=${b.n} W/L=${b.wins}/${b.losses} net=$${b.netPnl.toFixed(2)}`
    ),
  ];

  if (result.trades.length > 0) {
    lines.push('', 'Trades:');
    for (const t of result.trades) {
      lines.push(
        `  ${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.side} ${t.timeframe} ` +
          `SL=${t.slDistancePct.toFixed(2)}% → ${t.closeReason} PnL=$${t.pnlUsd.toFixed(2)}`
      );
    }
  }

  return lines.join('\n');
}
