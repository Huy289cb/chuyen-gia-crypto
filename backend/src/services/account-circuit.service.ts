/**
 * Phase 0 account circuits: daily loss %, peak drawdown %, expectancy kill.
 * Soft-block new entries (no flatten). Peak equity from starting_balance + snapshots.
 */

import { prisma } from '../lib/prisma';
import { getRiskPolicy } from '../config/risk-policy';
import { getDayBoundsICT } from '../utils/ict-time';
import { rollupExpectancyFromOutcomes } from './expectancy-rollup.service';

export interface CircuitStatus {
  allowed: boolean;
  reason: string;
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
export function calcDrawdownPercent(peakEquity: number, currentEquity: number): number {
  if (!(peakEquity > 0) || currentEquity >= peakEquity) return 0;
  return ((peakEquity - currentEquity) / peakEquity) * 100;
}

export async function resolvePeakEquity(
  accountId: number,
  currentEquity: number,
  startingBalance: number
): Promise<number> {
  const policy = getRiskPolicy();
  if (policy.circuitPeakEquityOverride != null) {
    return Math.max(policy.circuitPeakEquityOverride, currentEquity || 0);
  }
  const agg = await prisma.testnetAccountSnapshot.aggregate({
    where: { account_id: accountId },
    _max: { equity: true },
  });
  const snapPeak = agg._max.equity ?? 0;
  return Math.max(startingBalance || 0, currentEquity || 0, snapPeak || 0);
}

export async function getAccountCircuitStatus(accountId: number): Promise<CircuitStatus> {
  const policy = getRiskPolicy();
  const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return {
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

  const peakEquity = await resolvePeakEquity(accountId, equity, account.starting_balance);
  const drawdownPercent = calcDrawdownPercent(peakEquity, equity);

  if (drawdownPercent > (account.max_drawdown ?? 0)) {
    await prisma.testnetAccount.update({
      where: { id: accountId },
      data: { max_drawdown: drawdownPercent },
    });
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

  if (policy.circuitDailyLossEnabled && dailyLossPercent >= policy.dailyLossLimitPercent) {
    return {
      allowed: false,
      reason: `Daily loss circuit ${dailyLossPercent.toFixed(2)}% >= ${policy.dailyLossLimitPercent}%`,
      dailyLossUsd,
      dailyLossPercent,
      dailyLossLimitPercent: policy.dailyLossLimitPercent,
      peakEquity,
      drawdownPercent,
      maxDrawdownPercent: policy.maxDrawdownPercent,
      expectancy,
    };
  }

  if (policy.circuitDrawdownEnabled && drawdownPercent >= policy.maxDrawdownPercent) {
    return {
      allowed: false,
      reason: `Drawdown circuit ${drawdownPercent.toFixed(2)}% >= ${policy.maxDrawdownPercent}% from peak`,
      dailyLossUsd,
      dailyLossPercent,
      dailyLossLimitPercent: policy.dailyLossLimitPercent,
      peakEquity,
      drawdownPercent,
      maxDrawdownPercent: policy.maxDrawdownPercent,
      expectancy,
    };
  }

  if (
    policy.circuitExpectancyKillEnabled &&
    expectancy.n >= policy.circuitExpectancyWindow &&
    expectancy.sumR <= policy.circuitExpectancyMinSumR
  ) {
    return {
      allowed: false,
      reason:
        `Expectancy kill: last ${expectancy.n} closes sumR=${expectancy.sumR.toFixed(2)} ` +
        `<= ${policy.circuitExpectancyMinSumR} (avgR=${expectancy.avgR.toFixed(3)})`,
      dailyLossUsd,
      dailyLossPercent,
      dailyLossLimitPercent: policy.dailyLossLimitPercent,
      peakEquity,
      drawdownPercent,
      maxDrawdownPercent: policy.maxDrawdownPercent,
      expectancy,
    };
  }

  return {
    allowed: true,
    reason: 'circuits clear',
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

  const until = new Date(Date.now() + hours * 3_600_000);
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
    select: { cooldown_until: true },
  });
  if (account?.cooldown_until && account.cooldown_until > until) return;

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: { cooldown_until: until },
  });
  console.log(
    `[AccountCircuit] expectancy kill → cooldown until ${until.toISOString()} (${hours}h)`
  );
}
