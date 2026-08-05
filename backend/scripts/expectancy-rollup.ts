/**
 * CLI: recent expectancy from trade_outcomes.
 * Usage: npx tsx scripts/expectancy-rollup.ts [--n=20] [--days=14]
 */
import { prisma } from '../src/lib/prisma';
import {
  profitFactorLabel,
  rollupExpectancyFromOutcomes,
} from '../src/services/expectancy-rollup.service';
import { getAccountCircuitStatus } from '../src/services/account-circuit.service';
import { getRiskPolicy } from '../src/config/risk-policy';

function argNum(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const v = parseFloat(hit.slice(name.length + 3));
  return Number.isFinite(v) ? v : fallback;
}

async function main(): Promise<void> {
  const n = Math.max(1, Math.floor(argNum('n', 20)));
  const days = argNum('days', 0);

  const where =
    days > 0
      ? { timestamp: { gte: new Date(Date.now() - days * 86_400_000) } }
      : {};

  const rows = await prisma.tradeOutcome.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: days > 0 ? 500 : n,
    select: {
      realized_rr: true,
      realized_pnl: true,
      outcome: true,
      close_reason: true,
      timestamp: true,
      symbol: true,
    },
  });

  const window = days > 0 ? rows : rows.slice(0, n);
  const rollup = rollupExpectancyFromOutcomes(window);
  const policy = getRiskPolicy();

  console.log(
    JSON.stringify(
      {
        window: days > 0 ? `last_${days}d` : `last_${n}`,
        ...rollup,
        profitFactorLabel: profitFactorLabel(
          rollup.profitFactor,
          rollup.wins,
          rollup.losses
        ),
        kill:
          rollup.n >= policy.circuitExpectancyWindow &&
          rollup.sumR <= policy.circuitExpectancyMinSumR
            ? 'TRIP'
            : 'ok',
        policy: {
          dailyLossLimitPercent: policy.dailyLossLimitPercent,
          maxDrawdownPercent: policy.maxDrawdownPercent,
          circuitExpectancyWindow: policy.circuitExpectancyWindow,
          circuitExpectancyMinSumR: policy.circuitExpectancyMinSumR,
        },
      },
      null,
      2
    )
  );

  const account = await prisma.testnetAccount.findFirst({
    where: { symbol: 'BTC', method_id: 'kim_nghia' },
  });
  if (account) {
    const circuit = await getAccountCircuitStatus(account.id);
    console.log('\n=== LIVE CIRCUIT ===');
    console.log(
      JSON.stringify(
        {
          allowed: circuit.allowed,
          reason: circuit.reason,
          dailyLossPercent: circuit.dailyLossPercent,
          drawdownPercent: circuit.drawdownPercent,
          peakEquity: circuit.peakEquity,
          expectancyWindow: circuit.expectancy,
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
