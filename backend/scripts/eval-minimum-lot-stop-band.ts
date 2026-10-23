#!/usr/bin/env tsx
import 'dotenv/config';

import { loadBacktestCandles } from '../src/backtest/candle-loader';
import {
  runAdaptiveSetupReplay,
  type AdaptiveReplayCandidate,
  type AdaptiveReplayOutcome,
} from '../src/backtest/adaptive-setup-replay';

const DAY = 86_400_000;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function summarize(rows: AdaptiveReplayOutcome[], startMs: number, endMs: number) {
  const selected = rows.filter((row) => row.detectedAt >= startMs && row.detectedAt < endMs);
  const values = selected.map((row) => row.netR);
  const grossProfit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(
    values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)
  );
  let curve = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const value of values) {
    curve += value;
    peak = Math.max(peak, curve);
    maxDrawdownR = Math.max(maxDrawdownR, peak - curve);
  }
  return {
    n: values.length,
    wins: values.filter((value) => value > 0).length,
    losses: values.filter((value) => value < 0).length,
    win_rate: values.length
      ? values.filter((value) => value > 0).length / values.length
      : 0,
    sum_net_r: values.reduce((sum, value) => sum + value, 0),
    avg_net_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    profit_factor_net: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    max_drawdown_r: maxDrawdownR,
  };
}

async function main() {
  const symbol = arg('symbol') ?? 'BTC';
  const days = Math.max(180, Number(arg('days') ?? 720));
  const validationDays = Math.min(days / 2, Math.max(60, Number(arg('validation-days') ?? 240)));
  const end = arg('end') ? new Date(arg('end')!) : new Date();
  if (!Number.isFinite(end.getTime())) throw new Error('Invalid --end ISO date');
  const stops = (arg('stops') ?? '0.008,0.0082,0.0084,0.00858,0.0086')
    .split(',')
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (stops.length === 0) throw new Error('No valid --stops values');

  const start = new Date(end.getTime() - days * DAY);
  const splitMs = end.getTime() - validationDays * DAY;
  console.error(`[MinimumLotStopEval] loading ${symbol} ${days}d through ${end.toISOString()}`);
  const loaded = await loadBacktestCandles({
    symbol,
    weeks: Math.ceil(days / 7),
    timeframes: ['5m', '15m', '1h', '4h'],
    startDate: start,
    endDate: end,
    extraWarmupBarsPerTf: 150,
  });

  const rangeLong5m = (candidate: AdaptiveReplayCandidate) =>
    candidate.kind === 'range_sweep_reclaim' &&
    candidate.side === 'long' &&
    candidate.timeframe === '5m';
  const results = [];
  for (const minSlPct of stops) {
    console.error(`[MinimumLotStopEval] minSL=${(minSlPct * 100).toFixed(3)}%`);
    const replay = await runAdaptiveSetupReplay({
      byTf: loaded.byTf,
      start,
      end,
      symbol,
      minSlPct,
      rrByKind: { range_sweep_reclaim: 1.5 },
      candidateFilter: rangeLong5m,
    });
    const outcomes = replay.outcomes.filter((row) => row.kind === 'range_sweep_reclaim');
    results.push({
      min_sl_pct: minSlPct,
      train: summarize(outcomes, start.getTime(), splitMs),
      validation: summarize(outcomes, splitMs, end.getTime()),
      full: summarize(outcomes, start.getTime(), end.getTime()),
    });
  }

  const referenceBalance = Number(arg('balance') ?? 34.27714639);
  const referencePrice = Number(arg('price') ?? 79_894.5);
  const referenceMinQty = Number(arg('min-qty') ?? 0.001);
  const riskCapPct = Number(arg('risk-cap') ?? 2);
  const maxFeasibleStopPct =
    referenceBalance > 0 && referencePrice > 0 && referenceMinQty > 0
      ? (referenceBalance * (riskCapPct / 100)) / (referencePrice * referenceMinQty)
      : null;

  console.log(JSON.stringify({
    symbol,
    generated_at: new Date().toISOString(),
    period: { start, end, days, validation_days: validationDays },
    policy: {
      family: 'range_sweep_reclaim_long_5m',
      rr: 1.5,
      fixed_stop_exit_model: true,
      reference_wallet: {
        balance: referenceBalance,
        price: referencePrice,
        min_qty: referenceMinQty,
        risk_cap_pct: riskCapPct,
        max_feasible_stop_pct: maxFeasibleStopPct,
      },
    },
    results,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
