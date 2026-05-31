/**
 * One-off: remove erroneous trade_outcome from pipeline anchor backfill and recompute stats.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { recomputeTestnetAccountTradeStats } from '../src/services/position-pnl-backfill.service';

async function main(): Promise<void> {
  const bad = await prisma.tradeOutcome.findFirst({
    where: { decision_id: 1, realized_pnl: 0, close_reason: 'backfill_pnl' },
  });
  if (bad) {
    await prisma.tradeReflection.deleteMany({ where: { outcome_id: bad.id } });
    await prisma.tradeOutcome.delete({ where: { id: bad.id } });
    console.log(`[Fix] Deleted bogus outcome id=${bad.id}`);
  }

  await prisma.testnetPosition.update({
    where: { position_id: 'pipeline_v3_kim_nghia' },
    data: {
      close_reason: 'pipeline_event_anchor',
      realized_pnl: 0,
      close_price: null,
      close_time: null,
    },
  });

  await recomputeTestnetAccountTradeStats(1);
  const outcomes = await prisma.tradeOutcome.count();
  const acct = await prisma.testnetAccount.findFirst({ where: { id: 1 } });
  console.log('[Fix] Done', {
    outcomes,
    trades: acct?.total_trades,
    realized: acct?.realized_pnl,
    wins: acct?.winning_trades,
    losses: acct?.losing_trades,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
