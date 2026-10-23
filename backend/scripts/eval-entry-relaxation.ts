#!/usr/bin/env tsx
/**
 * Compact screen for controlled entry-policy relaxation variants.
 * Deterministic only: no LLM, no limit-fill simulation, no exchange writes.
 *
 * Usage:
 *   npx tsx scripts/eval-entry-relaxation.ts --days=30,60
 *   npx tsx scripts/eval-entry-relaxation.ts --days=60 --variants=baseline,relax-b70-trend-sweep
 *   npx tsx scripts/eval-entry-relaxation.ts --days=60 --end=2026-08-29 --json
 */

import 'dotenv/config';
import { runHistoricalTestbed } from '../src/backtest/historical-testbed.service';
import type { BacktestRunResult, BacktestTrade } from '../src/backtest/types';

const DEFAULT_VARIANTS = [
  'baseline',
  'grade-a-only',
  'relax-b70-trend-sweep',
  'relax-b70-trend-breakout',
  'relax-b70-trend-both',
  'relax-b70-no-bos',
  'relax-b70-range-sweep',
  'relax-b70-range-no-bos',
  'relax-b70-range-pb050',
  'relax-b70-range-no-bos-pb050',
  'relax-b70-range-both-no-bos-pb050',
];

function csv(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

function parseArgs(): {
  days: number[];
  variants: string[];
  endDate: Date;
  json: boolean;
  minRr?: number;
} {
  const args = process.argv.slice(2);
  const daysRaw = args.find((a) => a.startsWith('--days='))?.split('=')[1];
  const variantsRaw = args.find((a) => a.startsWith('--variants='))?.split('=')[1];
  const endRaw = args.find((a) => a.startsWith('--end='))?.split('=')[1];
  const minRrRaw = args.find((a) => a.startsWith('--min-rr='))?.split('=')[1];
  const days = csv(daysRaw || '30,60')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const endDate = endRaw ? new Date(`${endRaw}T00:00:00.000Z`) : new Date();
  if (!Number.isFinite(endDate.getTime())) throw new Error(`Invalid --end=${endRaw}`);
  const minRr = minRrRaw == null ? undefined : Number(minRrRaw);
  if (minRr != null && (!Number.isFinite(minRr) || minRr <= 0)) {
    throw new Error(`Invalid --min-rr=${minRrRaw}`);
  }
  return {
    days: days.length > 0 ? days : [30, 60],
    variants: variantsRaw ? csv(variantsRaw) : DEFAULT_VARIANTS,
    endDate,
    json: args.includes('--json'),
    minRr,
  };
}

function maxDrawdownUsd(trades: BacktestTrade[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.pnlUsd;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return maxDrawdown;
}

function profitFactor(trades: BacktestTrade[]): number | null {
  const grossProfit = trades.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0)
  );
  if (grossLoss === 0) return grossProfit > 0 ? null : 0;
  return grossProfit / grossLoss;
}

function compact(result: BacktestRunResult) {
  const bTrades = result.trades.filter((t) => t.grade === 'B');
  const weeks = result.breakdown?.byWeek ?? [];
  return {
    days: Math.round(result.period.weeks * 7),
    variant: result.variant?.id ?? 'baseline',
    entries: result.summary.entries,
    extraEntries: 0,
    wins: result.summary.wins,
    losses: result.summary.losses,
    winRatePct: Number((result.summary.winRate * 100).toFixed(1)),
    netPnlUsd: Number(result.summary.netPnlUsd.toFixed(2)),
    expectancyUsd: Number(
      (result.summary.entries ? result.summary.netPnlUsd / result.summary.entries : 0).toFixed(2)
    ),
    profitFactor: profitFactor(result.trades),
    maxDrawdownUsd: Number(maxDrawdownUsd(result.trades).toFixed(2)),
    maxLossStreak: result.summary.maxConsecutiveLosses,
    bEntries: bTrades.length,
    bNetPnlUsd: Number(bTrades.reduce((s, t) => s + t.pnlUsd, 0).toFixed(2)),
    positiveWeeks: weeks.filter((w) => w.netPnl > 0).length,
    totalWeeks: weeks.length,
    blocks: result.blocks,
  };
}

async function main() {
  const opts = parseArgs();
  const rows: ReturnType<typeof compact>[] = [];

  for (const days of opts.days) {
    const periodRows: ReturnType<typeof compact>[] = [];
    for (const variant of opts.variants) {
      const result = await runHistoricalTestbed({
        symbol: 'BTC',
        days,
        endDate: opts.endDate,
        variant,
        minRr: opts.minRr,
      });
      const row = compact(result);
      periodRows.push(row);
      if (!opts.json) {
        console.log(
          `[RelaxEval] ${days}d ${variant}: n=${row.entries} B=${row.bEntries} ` +
            `net=$${row.netPnlUsd} PF=${row.profitFactor?.toFixed(2) ?? '∞'} ` +
            `DD=$${row.maxDrawdownUsd} streak=${row.maxLossStreak}`
        );
      }
    }
    const baseline = periodRows.find((r) => r.variant === 'baseline') ?? periodRows[0];
    for (const row of periodRows) {
      row.extraEntries = baseline ? row.entries - baseline.entries : 0;
      rows.push(row);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.table(
    rows.map(({ blocks: _blocks, ...row }) => ({
      ...row,
      profitFactor: row.profitFactor == null ? '∞' : Number(row.profitFactor.toFixed(2)),
      positiveWeeks: `${row.positiveWeeks}/${row.totalWeeks}`,
    }))
  );
}

main().catch((error: unknown) => {
  console.error('[RelaxEval] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
