#!/usr/bin/env tsx
/**
 * Offline RR variant study {1.5, 2.0} vs RR3 baseline on the SAME kim_nghia playbooks.
 * Does NOT change live MIN_RR_RATIO.
 *
 * Bound-aware path: TP never dragged through targetBound — reject target_room instead.
 * Policy-TP path: historical testbed synthetic TP at minRr (fill/ROI stress).
 *
 * Usage:
 *   npx tsx scripts/study-rr-variants.ts --days=30
 *   npx tsx scripts/study-rr-variants.ts --days=30 --variant=relax-b70-trend-both --json
 */
import 'dotenv/config';
import { runHistoricalTestbed } from '../src/backtest/historical-testbed.service';
import { evaluateBoundAwareRrVariant } from '../src/utils/plan-feasibility';
import { computePolicyCompliantStopAndTarget } from '../src/utils/trade-levels';

const RR_VARIANTS = [1.5, 2.0, 3.0] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  const days = Number(args.find((a) => a.startsWith('--days='))?.split('=')[1] ?? '30');
  const variant = args.find((a) => a.startsWith('--variant='))?.split('=')[1] ?? 'baseline';
  const wallet = Number(args.find((a) => a.startsWith('--wallet='))?.split('=')[1] ?? '33.59964603');
  return {
    days: Number.isFinite(days) && days > 0 ? days : 30,
    variant,
    wallet: Number.isFinite(wallet) && wallet > 0 ? wallet : 33.59964603,
    json: args.includes('--json'),
  };
}

/** Self-check: bound-aware rejects RR3 when room only supports ~1.5; never invents TP past bound. */
function selfCheckBoundAware(): void {
  const entry = 100_000;
  const stopLoss = entry * (1 - 0.008);
  const targetBound = entry + (entry - stopLoss) * 1.5; // room for RR1.5 only
  const at15 = evaluateBoundAwareRrVariant({
    side: 'long',
    entry,
    stopLoss,
    targetBound,
    minSlFraction: 0.008,
    minRr: 1.5,
  });
  const at30 = evaluateBoundAwareRrVariant({
    side: 'long',
    entry,
    stopLoss,
    targetBound,
    minSlFraction: 0.008,
    minRr: 3,
  });
  if (!at15.pass || at15.takeProfit == null || at15.takeProfit > targetBound + 1e-9) {
    throw new Error('bound-aware RR1.5 self-check failed');
  }
  if (at30.pass || at30.reason !== 'target_room') {
    throw new Error(`bound-aware RR3 must reject target_room, got ${JSON.stringify(at30)}`);
  }
  // Policy TP at RR3 would exceed bound — geometry flags target_bound_exceeded when TP forced.
  const policy = computePolicyCompliantStopAndTarget({
    action: 'buy',
    entry,
    minSlPct: 0.008,
    minRr: 3,
  });
  if (!policy || policy.takeProfit <= targetBound) {
    throw new Error('expected policy RR3 TP beyond bound for contrast');
  }
}

async function main() {
  selfCheckBoundAware();
  const opts = parseArgs();
  const rows = [];

  for (const minRr of RR_VARIANTS) {
    const result = await runHistoricalTestbed({
      symbol: 'BTC',
      days: opts.days,
      variant: opts.variant,
      minRr,
      // Stress sizing against live-like 3% cap / day10% via wallet path when provided.
      executionWalletUsd: opts.wallet,
      feePctPerSide: 0.0005,
      slippagePct: 0.001,
    });
    const entries = result.summary.entries;
    const decided = result.summary.wins + result.summary.losses;
    const avgNetR =
      entries > 0
        ? result.trades.reduce((s, t) => {
            const risk = Math.abs(t.entryPrice - t.stopLoss) * ((t.notionalUsd ?? 0) / t.entryPrice || 1);
            return s + (risk > 0 ? t.pnlUsd / risk : 0);
          }, 0) / entries
        : 0;
    rows.push({
      role: 'offline_rr_variant_not_live',
      minRr,
      liveMinRrUnchanged: 3,
      variant: result.variant?.id ?? opts.variant,
      period: result.period,
      entries,
      fillRateVsSignals:
        result.summary.signalsPassed > 0 ? entries / result.summary.signalsPassed : 0,
      winRate: result.summary.winRate,
      netPnlUsd: result.summary.netPnlUsd,
      feesUsd: result.summary.feesUsd,
      avgNetER: Number(avgNetR.toFixed(4)),
      blocks: result.blocks,
      decided,
    });
  }

  const report = {
    schema: 'rr-variant-study-v1',
    note:
      'Offline only. Bound-aware self-check ensures TP is not dragged through targetBound. ' +
      'Testbed rows use policy TP at each minRr for fill/ROI stress; live MIN_RR_RATIO stays 3.',
    selfCheck: 'bound_aware_ok',
    rows,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`[RrStudy] variant=${opts.variant} days=${opts.days} (live MIN_RR unchanged)`);
  for (const row of rows) {
    console.log(
      `  RR=${row.minRr} entries=${row.entries} fillVsSig=${(row.fillRateVsSignals * 100).toFixed(1)}% ` +
        `WR=${(row.winRate * 100).toFixed(1)}% net=$${row.netPnlUsd.toFixed(2)} avgE/R=${row.avgNetER}`
    );
  }
}

main().catch((err: unknown) => {
  console.error('[RrStudy] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
