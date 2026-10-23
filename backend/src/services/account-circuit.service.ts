import {recordEntryStage} from '../utils/entry-trace';
import { calcDrawdownPercent } from '../utils/account-drawdown-percent';
import { randomUUID } from 'node:crypto';
/**
 * Phase 0 account circuits: daily loss %, peak drawdown %, expectancy kill.
 * Soft-block new entries (no flatten). Peak equity from starting_balance + snapshots.
 */

import { prisma } from '../lib/prisma';
import { getRiskPolicy } from '../config/risk-policy';
import { getDayBoundsICT } from '../utils/ict-time';
import { rollupExpectancyFromOutcomes } from './expectancy-rollup.service';
import { evaluateAccountCircuits } from '../utils/account-circuit-evaluation';

export interface CircuitStatus {
  scope: 'strategy_epoch';
  epochStart: Date | null;
  peakEquitySource:
    | 'override'
    | 'override_ratcheted'
    | 'strategy_epoch_snapshots'
    | 'full_history_snapshots';
  expectancySince: Date | null;
  allowed: boolean;
  reason: string;
  startEquity?: number;
  dailyLossUsd: number;
  dailyLossPercent: number;
  dailyLossLimitPercent: number;
  peakEquity: number;
  drawdownPercent: number;
  maxDrawdownPercent: number;
  expectancy: {
    n: number;
    sumR: number;
    avgR: number;
    profitFactor: number | null;
  };
}

/** Loss from day-start equity as percent of start (0 if flat/up). */
export function calcDailyLossPercent(startEquity: number, currentEquity: number): number {
  if (!(startEquity > 0) || currentEquity >= startEquity) return 0;
  return ((startEquity - currentEquity) / startEquity) * 100;
}

/** Drawdown from peak as percent of peak (0 if at/above peak). */
export { calcDrawdownPercent } from '../utils/account-drawdown-percent';

export async function resolvePeakEquity(
  accountId: number,
  currentEquity: number,
  startingBalance: number
): Promise<number> {
  const resolved = await resolveCircuitPeakEquity(accountId, currentEquity, startingBalance);
  return resolved.peakEquity;
}

async function resolveCircuitPeakEquity(
  accountId: number,
  currentEquity: number,
  startingBalance: number
): Promise<{
  peakEquity: number;
  source: CircuitStatus['peakEquitySource'];
}> {
  const policy = getRiskPolicy();
  if (policy.circuitPeakEquityOverride != null) {
    // The override is an epoch seed, not a permanent ceiling. Once live equity
    // makes a higher peak, retain it from strategy-epoch snapshots so drawdown
    // cannot silently fall back to the old manual value after equity declines.
    const agg = policy.circuitExpectancySince
      ? await prisma.testnetAccountSnapshot.aggregate({
          where: {
            account_id: accountId,
            timestamp: { gte: policy.circuitExpectancySince },
          },
          _max: { equity: true },
        })
      : null;
    const snapshotPeak = agg?._max.equity ?? 0;
    const peakEquity = Math.max(
      policy.circuitPeakEquityOverride,
      currentEquity || 0,
      snapshotPeak
    );
    return {
      peakEquity,
      source:
        peakEquity > policy.circuitPeakEquityOverride
          ? 'override_ratcheted'
          : 'override',
    };
  }

  if (policy.circuitExpectancySince) {
    const [baseline, agg] = await Promise.all([
      prisma.testnetAccountSnapshot.findFirst({
        where: {
          account_id: accountId,
          timestamp: { lt: policy.circuitExpectancySince },
        },
        orderBy: { timestamp: 'desc' },
        select: { equity: true },
      }),
      prisma.testnetAccountSnapshot.aggregate({
        where: {
          account_id: accountId,
          timestamp: { gte: policy.circuitExpectancySince },
        },
        _max: { equity: true },
      }),
    ]);
    return {
      peakEquity: Math.max(
        baseline?.equity ?? startingBalance ?? 0,
        currentEquity || 0,
        agg._max.equity ?? 0
      ),
      source: 'strategy_epoch_snapshots',
    };
  }

  const agg = await prisma.testnetAccountSnapshot.aggregate({
    where: { account_id: accountId },
    _max: { equity: true },
  });
  const snapPeak = agg._max.equity ?? 0;
  return {
    peakEquity: Math.max(startingBalance || 0, currentEquity || 0, snapPeak || 0),
    source: 'full_history_snapshots',
  };
}

function publishCircuitMutation(evidence: Record<string, unknown>, appliedAt: string): void {
  void import('../utils/account-wallet-journal').then(module => module.persistAccountWalletObservation(
    { ...evidence, applied_at: appliedAt, applied_clock_source: 'db_update_return' },
    'account_circuit_mutation_applied'))
    .catch(() => console.warn('[AccountCircuit] Mutation journal unavailable'));
}

export async function getAccountCircuitStatus(accountId: number): Promise<CircuitStatus> {
  const readsStartedAt = new Date().toISOString();
  const policy = getRiskPolicy();
  const scope = {
    scope: 'strategy_epoch' as const,
    epochStart: policy.circuitExpectancySince,
    expectancySince: policy.circuitExpectancySince,
  };
  const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return {
      ...scope,
      peakEquitySource: policy.circuitPeakEquityOverride != null ? 'override' :
        policy.circuitExpectancySince ? 'strategy_epoch_snapshots' : 'full_history_snapshots',
      allowed: false,
      reason: 'Testnet account not found',
      dailyLossUsd: 0,
      dailyLossPercent: 0,
      dailyLossLimitPercent: policy.dailyLossLimitPercent,
      peakEquity: 0,
      drawdownPercent: 0,
      maxDrawdownPercent: policy.maxDrawdownPercent,
      expectancy: { n: 0, sumR: 0, avgR: 0, profitFactor: null },
    };
  }

  const equity = account.equity ?? account.current_balance ?? 0;
  const { dayStart } = getDayBoundsICT();
  const baseline = await prisma.testnetAccountSnapshot.findFirst({
    where: { account_id: accountId, timestamp: { lt: dayStart } },
    orderBy: { timestamp: 'desc' },
  });
  const startEquity = baseline?.equity ?? equity;
  const dailyLossUsd = equity < startEquity ? startEquity - equity : 0;
  const dailyLossPercent = calcDailyLossPercent(startEquity, equity);

  const peak = await resolveCircuitPeakEquity(accountId, equity, account.starting_balance);
  const peakEquity = peak.peakEquity;
  const drawdownPercent = calcDrawdownPercent(peakEquity, equity);

  if (drawdownPercent > (account.max_drawdown ?? 0)) {
    const evidence = { schema: 'account-circuit-mutation-v1', account_id: accountId,
      circuit_attempt_id: randomUUID(), kind: 'max_drawdown_overwrite',
      input: { previous_max_drawdown: account.max_drawdown ?? null, equity, peak_equity: peakEquity,
        peak_equity_source: peak.source, drawdown_percent: drawdownPercent },
      update: { max_drawdown: drawdownPercent }, write_started_at: new Date().toISOString() };
    await prisma.testnetAccount.update({
      where: { id: accountId },
      data: { max_drawdown: drawdownPercent },
    });
    const appliedAt = new Date().toISOString();
    publishCircuitMutation(evidence, appliedAt);
  }

  const outcomes = await prisma.tradeOutcome.findMany({
    where: policy.circuitExpectancySince
      ? { timestamp: { gte: policy.circuitExpectancySince } }
      : undefined,
    orderBy: { timestamp: 'desc' },
    take: policy.circuitExpectancyWindow,
    select: { realized_rr: true, realized_pnl: true },
  });
  const expectancy = rollupExpectancyFromOutcomes(outcomes);

  const decision = evaluateAccountCircuits(policy, { dailyLossPercent, drawdownPercent, expectancy });
  const inputsResolvedAt = new Date().toISOString();
  await recordEntryStage('account_circuit_decision_evaluated', { account_id: accountId,
    circuit_decision: { schema: 'account-circuit-decision-v1', reads_started_at: readsStartedAt,
      inputs_resolved_at: inputsResolvedAt,
      policy: { circuitDailyLossEnabled: policy.circuitDailyLossEnabled, dailyLossLimitPercent: policy.dailyLossLimitPercent,
        circuitDrawdownEnabled: policy.circuitDrawdownEnabled, maxDrawdownPercent: policy.maxDrawdownPercent,
        circuitExpectancyKillEnabled: policy.circuitExpectancyKillEnabled, circuitExpectancyWindow: policy.circuitExpectancyWindow,
        circuitExpectancyMinSumR: policy.circuitExpectancyMinSumR },
      state: { dailyLossPercent, drawdownPercent, expectancy }, decision,
      query_context: { equity, startEquity, peakEquity, peak_source: peak.source,
        day_start: dayStart.toISOString(), expectancy_since: policy.circuitExpectancySince?.toISOString() ?? null,
        outcome_rows: outcomes.length, outcome_scope: 'legacy_global', query_lineage: 'not_established',
        atomic_account_state: 'not_established' } } });

  return {
    ...scope,
    peakEquitySource: peak.source,
    ...decision,
    startEquity,
    dailyLossUsd,
    dailyLossPercent,
    dailyLossLimitPercent: policy.dailyLossLimitPercent,
    peakEquity,
    drawdownPercent,
    maxDrawdownPercent: policy.maxDrawdownPercent,
    expectancy,
  };
}

/** Sticky pause when expectancy kill trips (idempotent if longer cooldown already set). */
export async function applyExpectancyKillCooldownIfNeeded(
  accountId: number,
  status: CircuitStatus
): Promise<void> {
  const policy = getRiskPolicy();
  if (status.allowed || !status.reason.startsWith('Expectancy kill:')) return;

  const hours = policy.circuitExpectancyCooldownHours;
  if (!(hours > 0)) return;

  const selectedAt = Date.now();
  const until = new Date(selectedAt + hours * 3_600_000);
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
    select: { cooldown_until: true },
  });
  if (account?.cooldown_until && account.cooldown_until > until) return;

  const evidence = { schema: 'account-circuit-mutation-v1', account_id: accountId,
    circuit_attempt_id: randomUUID(), kind: 'expectancy_cooldown_overwrite',
    input: { allowed: status.allowed, reason: status.reason, cooldown_hours: hours,
      previous_cooldown_until: account?.cooldown_until && Number.isFinite(account.cooldown_until.getTime()) ? account.cooldown_until.toISOString() : null,
      previous_cooldown_status: account?.cooldown_until ? (Number.isFinite(account.cooldown_until.getTime()) ? 'valid' : 'invalid') : 'absent',
      selected_at: new Date(selectedAt).toISOString(),
      selected_until: until.toISOString() }, update: { cooldown_until: until.toISOString() },
    write_started_at: new Date().toISOString() };
  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: { cooldown_until: until },
  });
  const appliedAt = new Date().toISOString();
  publishCircuitMutation(evidence, appliedAt);
  console.log(
    `[AccountCircuit] expectancy kill → cooldown until ${until.toISOString()} (${hours}h)`
  );
}
