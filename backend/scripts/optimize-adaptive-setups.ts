import 'dotenv/config';

import { loadBacktestCandles } from '../src/backtest/candle-loader';
import {
  runAdaptiveSetupReplay,
  type AdaptiveReplayCandidate,
  type AdaptiveReplayOutcome,
} from '../src/backtest/adaptive-setup-replay';
import type { AdaptiveSetupKind } from '../src/config/adaptive-setup-policy';

const DAY = 86_400_000;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function stats(rows: AdaptiveReplayOutcome[], startMs: number, endMs: number) {
  const selected = rows.filter((row) => row.detectedAt >= startMs && row.detectedAt < endMs);
  const values = selected.map((row) => row.netR);
  const profit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const loss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const folds = Math.ceil((endMs - startMs) / (30 * DAY));
  const foldSums = Array.from({ length: folds }, (_, index) => {
    const from = startMs + index * 30 * DAY;
    const to = Math.min(endMs, from + 30 * DAY);
    return selected
      .filter((row) => row.detectedAt >= from && row.detectedAt < to)
      .reduce((sum, row) => sum + row.netR, 0);
  });
  const active = foldSums.filter((value) => Math.abs(value) > 1e-9);
  return {
    n: values.length,
    wins: values.filter((value) => value > 0).length,
    sum_net_r: values.reduce((sum, value) => sum + value, 0),
    avg_net_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    profit_factor_net: loss > 0 ? profit / loss : profit > 0 ? null : 0,
    positive_active_folds: active.filter((value) => value > 0).length,
    active_folds: active.length,
    fold_net_r: foldSums,
  };
}

type Policy = {
  name: string;
  kind: AdaptiveSetupKind;
  rr?: number;
  ttl?: number;
  edge?: number;
  rangeBos?: boolean;
  filter: (candidate: AdaptiveReplayCandidate) => boolean;
};

const rangeLong5m = (candidate: AdaptiveReplayCandidate) =>
  candidate.kind === 'range_sweep_reclaim' &&
  candidate.side === 'long' &&
  candidate.timeframe === '5m';
const microAligned1h = (candidate: AdaptiveReplayCandidate) =>
  candidate.kind === 'aligned_micro_bos' &&
  candidate.context.htf_1h_direction != null;
const microShortAligned1h = (candidate: AdaptiveReplayCandidate) =>
  microAligned1h(candidate) && candidate.side === 'short';
const earlyOnly = (candidate: AdaptiveReplayCandidate) =>
  candidate.kind === 'early_structure_flip';

const policies: Policy[] = [
  { name: 'range_long_5m_rr1.5', kind: 'range_sweep_reclaim', rr: 1.5, filter: rangeLong5m },
  { name: 'range_long_5m_rr2', kind: 'range_sweep_reclaim', rr: 2, filter: rangeLong5m },
  { name: 'range_long_5m_rr2.5', kind: 'range_sweep_reclaim', rr: 2.5, filter: rangeLong5m },
  { name: 'range_long_5m_rr3', kind: 'range_sweep_reclaim', rr: 3, filter: rangeLong5m },
  { name: 'range_long_5m_ttl45', kind: 'range_sweep_reclaim', rr: 2, ttl: 45, filter: rangeLong5m },
  { name: 'range_long_5m_ttl180', kind: 'range_sweep_reclaim', rr: 2, ttl: 180, filter: rangeLong5m },
  { name: 'range_long_5m_edge20', kind: 'range_sweep_reclaim', rr: 2, edge: 0.2, filter: rangeLong5m },
  { name: 'range_long_5m_edge40', kind: 'range_sweep_reclaim', rr: 2, edge: 0.4, filter: rangeLong5m },
  { name: 'range_long_5m_no_bos_rr1.5', kind: 'range_sweep_reclaim', rr: 1.5, rangeBos: false, filter: rangeLong5m },
  { name: 'range_long_5m_no_bos_rr2', kind: 'range_sweep_reclaim', rr: 2, rangeBos: false, filter: rangeLong5m },
  { name: 'range_long_5m_no_bos_rr2.5', kind: 'range_sweep_reclaim', rr: 2.5, rangeBos: false, filter: rangeLong5m },
  { name: 'micro_1h_aligned_rr2', kind: 'aligned_micro_bos', rr: 2, filter: microAligned1h },
  { name: 'micro_1h_aligned_rr3', kind: 'aligned_micro_bos', rr: 3, filter: microAligned1h },
  { name: 'micro_short_1h_aligned_rr2', kind: 'aligned_micro_bos', rr: 2, filter: microShortAligned1h },
  { name: 'micro_short_1h_aligned_rr3', kind: 'aligned_micro_bos', rr: 3, filter: microShortAligned1h },
  { name: 'early_ttl360_rr2', kind: 'early_structure_flip', rr: 2, ttl: 360, filter: earlyOnly },
  { name: 'early_ttl360_rr3', kind: 'early_structure_flip', rr: 3, ttl: 360, filter: earlyOnly },
  { name: 'early_ttl720_rr2', kind: 'early_structure_flip', rr: 2, ttl: 720, filter: earlyOnly },
];

async function main() {
  const symbol = arg('symbol') ?? 'BTC';
  const days = Math.max(180, Number(arg('days') ?? 360));
  const validationDays = Math.max(60, Number(arg('validation-days') ?? 120));
  const end = arg('end') ? new Date(arg('end')!) : new Date();
  const start = new Date(end.getTime() - days * DAY);
  console.error(`[AdaptiveOptimize] load ${symbol} ${days}d`);
  const loaded = await loadBacktestCandles({
    symbol,
    weeks: Math.ceil(days / 7),
    timeframes: ['5m', '15m', '1h', '4h'],
    startDate: start,
    endDate: end,
    extraWarmupBarsPerTf: 150,
  });
  const splitMs = end.getTime() - validationDays * DAY;
  const quickNames = new Set([
    'range_long_5m_rr1.5',
    'range_long_5m_no_bos_rr2',
    'micro_1h_aligned_rr2',
    'early_ttl360_rr2',
  ]);
  const selectedPolicies = arg('quick') === 'true'
    ? policies.filter((policy) => quickNames.has(policy.name))
    : policies;
  const requestedNames = new Set(
    (arg('names') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  );
  const runnablePolicies = requestedNames.size > 0
    ? selectedPolicies.filter((policy) => requestedNames.has(policy.name))
    : selectedPolicies;
  const results = [];
  for (const policy of runnablePolicies) {
    console.error(`[AdaptiveOptimize] ${policy.name}`);
    const replay = await runAdaptiveSetupReplay({
      byTf: loaded.byTf,
      start,
      end,
      symbol,
      rrByKind: policy.rr == null ? undefined : { [policy.kind]: policy.rr },
      ttlByKind: policy.ttl == null ? undefined : { [policy.kind]: policy.ttl },
      rangeEdgeFraction: policy.edge,
      rangeRequireMicroBos: policy.rangeBos,
      candidateFilter: policy.filter,
    });
    const rows = replay.outcomes.filter((row) => row.kind === policy.kind);
    results.push({
      policy: policy.name,
      kind: policy.kind,
      parameters: {
        rr: policy.rr,
        ttl_minutes: policy.ttl,
        range_edge_fraction: policy.edge,
        range_require_bos: policy.rangeBos,
      },
      train: stats(rows, start.getTime(), splitMs),
      validation: stats(rows, splitMs, end.getTime()),
      full: stats(rows, start.getTime(), end.getTime()),
    });
  }
  console.log(JSON.stringify({ symbol, days, validation_days: validationDays, start, end, results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
