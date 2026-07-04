#!/usr/bin/env tsx
/**
 * Walk-forward historical testbed (signal gate + HTF guard, no LLM).
 *
 * Usage:
 *   npm run backtest:historical
 *   npm run backtest:historical -- --weeks=4
 *   npm run backtest:historical -- --weeks=3 --sl-sweep=0.004,0.005,0.006
 *   npm run backtest:historical -- --json
 */

import 'dotenv/config';
import {
  formatTestbedReport,
  runHistoricalTestbed,
  runHistoricalTestbedSlSweep,
} from '../src/backtest/historical-testbed.service';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: {
    weeks: number;
    symbol: string;
    json: boolean;
    slSweep: number[] | null;
    minSl: number | null;
  } = {
    weeks: 3,
    symbol: 'BTC',
    json: false,
    slSweep: null,
    minSl: null,
  };

  for (const arg of args) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--weeks=')) opts.weeks = parseFloat(arg.split('=')[1] ?? '3');
    else if (arg.startsWith('--symbol=')) opts.symbol = arg.split('=')[1] ?? 'BTC';
    else if (arg.startsWith('--min-sl=')) opts.minSl = parseFloat(arg.split('=')[1] ?? '0.004');
    else if (arg.startsWith('--sl-sweep=')) {
      opts.slSweep = (arg.split('=')[1] ?? '')
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`[Testbed] Loading ${opts.weeks}w of ${opts.symbol} candles from Binance...`);

  if (opts.slSweep && opts.slSweep.length > 0) {
    const results = await runHistoricalTestbedSlSweep(opts.slSweep, {
      symbol: opts.symbol,
      weeks: opts.weeks,
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
          `net $${r.summary.netPnlUsd.toFixed(2)}`
      );
    }
    return;
  }

  const result = await runHistoricalTestbed({
    symbol: opts.symbol,
    weeks: opts.weeks,
    minSlPct: opts.minSl ?? undefined,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatTestbedReport(result));
}

main().catch((err: unknown) => {
  console.error('[Testbed] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
