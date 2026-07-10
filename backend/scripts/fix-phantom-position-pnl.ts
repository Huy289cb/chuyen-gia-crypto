/**
 * Zero phantom PnL on internal/sync closes and align account stats with Binance wallet.
 *
 *   npx tsx scripts/fix-phantom-position-pnl.ts
 */

import { prisma } from '../src/lib/prisma';
import { PIPELINE_EVENT_POSITION_ID } from '../src/repositories/testnet.repository';
import { isInternalCloseReason } from '../src/utils/bookkeeping-close';
import { reconcileTestnetWalletFromBinance } from '../src/services/wallet-reconcile.service';

async function main(): Promise<void> {
  const account = await prisma.testnetAccount.findFirst({
    where: { symbol: 'BTC', method_id: 'kim_nghia' },
  });
  if (!account) {
    console.error('No BTC/kim_nghia account');
    process.exit(1);
  }

  const closed = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: 'closed',
      position_id: { not: PIPELINE_EVENT_POSITION_ID },
    },
  });

  let fixed = 0;
  for (const pos of closed) {
    if (!isInternalCloseReason(pos.close_reason)) continue;
    const pnl = Number(pos.realized_pnl) || 0;
    if (Math.abs(pnl) < 0.01) continue;

    await prisma.testnetPosition.update({
      where: { position_id: pos.position_id },
      data: {
        realized_pnl: 0,
        close_reason: 'reconciliation_bookkeeping',
      },
    });
    console.log(`zeroed ${pos.position_id} was ${pnl.toFixed(2)} (${pos.close_reason})`);
    fixed += 1;
  }

  if (process.env.BINANCE_ENABLED === 'true') {
    const wr = await reconcileTestnetWalletFromBinance(account.id);
    console.log(
      `wallet=${wr.walletBalance.toFixed(2)} binanceRealized=${wr.binanceRealizedPnl.toFixed(2)} ` +
        `posSum=${wr.positionRealizedSum.toFixed(2)} gap=${(wr.walletDelta - wr.netTradingPnl).toFixed(4)}`
    );
  }

  console.log(`Done — fixed ${fixed} position(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
