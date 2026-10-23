import 'dotenv/config';

import { loadBacktestCandles } from '../src/backtest/candle-loader';
import {
  runAdaptiveSetupReplay,
  type AdaptiveReplayResult,
} from '../src/backtest/adaptive-setup-replay';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function compact(result: AdaptiveReplayResult, includeOutcomes = false) {
  return {
    period: result.period,
    config: result.config,
    by_kind: result.byKind,
    ...(includeOutcomes ? { outcomes: result.outcomes } : {}),
  };
}

async function main() {
  const symbol = arg('symbol') ?? 'BTC';
  const end = arg('end') ? new Date(arg('end')!) : new Date();
  if (!Number.isFinite(end.getTime())) throw new Error('Invalid --end ISO date');
  const days = (arg('days') ?? '30,90,180')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map(Math.floor);
  if (days.length === 0) throw new Error('No valid --days values');
  const maxDays = Math.max(...days);
  const includeOutcomes = arg('include-outcomes') === 'true';
  const runWalkForward = arg('walk-forward') !== 'false';
  const loadStart = new Date(end.getTime() - maxDays * 86_400_000);
  console.error(`[AdaptiveReplay] loading ${symbol} ${maxDays}d through ${end.toISOString()}`);
  const loaded = await loadBacktestCandles({
    symbol,
    weeks: Math.ceil(maxDays / 7),
    timeframes: ['5m', '15m', '1h', '4h'],
    startDate: loadStart,
    endDate: end,
    extraWarmupBarsPerTf: 150,
  });

  const windows = [];
  for (const windowDays of days) {
    const start = new Date(end.getTime() - windowDays * 86_400_000);
    console.error(`[AdaptiveReplay] evaluating trailing ${windowDays}d`);
    windows.push({
      days: windowDays,
      result: compact(
        await runAdaptiveSetupReplay({ byTf: loaded.byTf, start, end, symbol }),
        includeOutcomes
      ),
    });
  }

  const walkForward = [];
  const foldDays = Number(arg('fold-days') ?? 30);
  const folds = runWalkForward ? Math.floor(maxDays / foldDays) : 0;
  for (let index = folds - 1; index >= 0; index -= 1) {
    const foldEnd = new Date(end.getTime() - index * foldDays * 86_400_000);
    const foldStart = new Date(foldEnd.getTime() - foldDays * 86_400_000);
    console.error(`[AdaptiveReplay] walk-forward ${foldStart.toISOString()} -> ${foldEnd.toISOString()}`);
    walkForward.push(compact(await runAdaptiveSetupReplay({
      byTf: loaded.byTf,
      start: foldStart,
      end: foldEnd,
      symbol,
    })));
  }

  console.log(JSON.stringify({ symbol, generated_at: new Date().toISOString(), windows, walk_forward: walkForward }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
