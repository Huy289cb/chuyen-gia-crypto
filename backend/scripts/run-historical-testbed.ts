#!/usr/bin/env tsx
/**
 * Walk-forward historical testbed (signal gate + HTF guard, no LLM).
 *
 * Usage:
 *   npm run backtest:historical
 *   npm run backtest:historical -- --days=30
 *   npm run backtest:historical -- --variant=grade-a-only --days=30
 *   npm run backtest:historical -- --sweep-weeks=2,3,4,6 --variant=baseline,cooldown,combo
 *   npm run backtest:historical -- --weeks=3 --sl-sweep=0.004,0.005,0.006
 *   npm run backtest:historical -- --json
 */

import 'dotenv/config';
import { TESTBED_VARIANTS } from '../src/config/testbed-variants';
import {
  formatTestbedReport,
  runHistoricalTestbed,
  runHistoricalTestbedSlSweep,
} from '../src/backtest/historical-testbed.service';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: {
    weeks: number | null;
    days: number | null;
    symbol: string;
    json: boolean;
    slSweep: number[] | null;
    minSl: number | null;
    variant: string | null;
    sweepWeeks: number[] | null;
    sweepVariants: string[] | null;
  } = {
    weeks: null,
    days: null,
    symbol: 'BTC',
    json: false,
    slSweep: null,
    minSl: null,
    variant: null,
    sweepWeeks: null,
    sweepVariants: null,
  };

  for (const arg of args) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--weeks=')) opts.weeks = parseFloat(arg.split('=')[1] ?? '3');
    else if (arg.startsWith('--days=')) opts.days = parseFloat(arg.split('=')[1] ?? '30');
    else if (arg.startsWith('--symbol=')) opts.symbol = arg.split('=')[1] ?? 'BTC';
    else if (arg.startsWith('--min-sl=')) opts.minSl = parseFloat(arg.split('=')[1] ?? '0.004');
    else if (arg.startsWith('--variant=')) opts.variant = arg.split('=')[1] ?? 'baseline';
    else if (arg.startsWith('--sweep-weeks=')) {
      opts.sweepWeeks = (arg.split('=')[1] ?? '')
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (arg.startsWith('--sweep-variants=')) {
      opts.sweepVariants = (arg.split('=')[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--sl-sweep=')) {
      opts.slSweep = (arg.split('=')[1] ?? '')
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
  }

  return opts;
}

function periodLabel(days: number | null, weeks: number | null): string {
  if (days) return `${days}d`;
  return `${weeks ?? 3}w`;
}

async function main() {
  const opts = parseArgs();
  const variants =
    opts.sweepVariants ??
    (opts.variant ? [opts.variant] : ['baseline']);
  const periods =
    opts.sweepWeeks?.map((w) => ({ weeks: w, days: null as number | null })) ??
    [{ weeks: opts.weeks ?? 3, days: opts.days }];

  console.log(
    `[Testbed] ${opts.symbol} | periods=${periods.map((p) => periodLabel(p.days, p.weeks)).join(',')} | variants=${variants.join(',')}`
  );

  if (opts.slSweep && opts.slSweep.length > 0) {
    const p = periods[0];
    const results = await runHistoricalTestbedSlSweep(opts.slSweep, {
      symbol: opts.symbol,
      weeks: p.weeks ?? undefined,
      days: p.days ?? undefined,
      variant: variants[0],
    });
    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    for (const r of results) {
      console.log(formatTestbedReport(r));
      console.log('\n' + '─'.repeat(60) + '\n');
    }
    console.log('SL sweep summary:');
    for (const r of results) {
      console.log(
        `  minSL=${(r.config.minSlPct * 100).toFixed(2)}% → ` +
          `${r.summary.entries} trades, WR ${(r.summary.winRate * 100).toFixed(1)}%, ` +
          `net $${r.summary.netPnlUsd.toFixed(2)}, maxLoss=${r.summary.maxConsecutiveLosses}`
      );
    }
    return;
  }

  const allResults: Awaited<ReturnType<typeof runHistoricalTestbed>>[] = [];
  for (const variant of variants) {
    for (const p of periods) {
      allResults.push(
        await runHistoricalTestbed({
          symbol: opts.symbol,
          weeks: p.weeks ?? undefined,
          days: p.days ?? undefined,
          minSlPct: opts.minSl ?? undefined,
          variant,
        })
      );
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(allResults.length === 1 ? allResults[0] : allResults, null, 2));
    return;
  }

  for (const r of allResults) {
    console.log(formatTestbedReport(r));
    console.log('\n' + '─'.repeat(60) + '\n');
  }

  if (allResults.length > 1) {
    console.log('Sweep summary (net PnL / WR / max loss streak):');
    for (const r of allResults) {
      const v = r.variant?.id ?? 'baseline';
      console.log(
        `  ${v} ~${r.period.weeks.toFixed(1)}w → ` +
          `${r.summary.entries} trades, WR ${(r.summary.winRate * 100).toFixed(1)}%, ` +
          `net $${r.summary.netPnlUsd.toFixed(2)}, maxLoss=${r.summary.maxConsecutiveLosses}`
      );
    }
    console.log('\nKnown variants:', Object.keys(TESTBED_VARIANTS).join(', '));
  }
}

main().catch((err: unknown) => {
  console.error('[Testbed] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
