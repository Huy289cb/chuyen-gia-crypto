/**
 * Re-backfill closed position PnL from Binance userTrades fills.
 *
 * Usage:
 *   npm run testnet:reconcile-position-pnl
 *   npm run testnet:reconcile-position-pnl -- --dry-run
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { runClosedPositionPnlReconcile } from '../src/services/position-pnl-reconcile.service';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const symbol = process.env.RECONCILE_SYMBOL ?? 'BTC';
  const methodId = process.env.RECONCILE_METHOD_ID ?? 'kim_nghia';

  console.log(`[PositionPnLReconcile] symbol=${symbol} method=${methodId} dryRun=${dryRun}`);

  const summary = await runClosedPositionPnlReconcile({ symbol, methodId, dryRun });
  console.log('[PositionPnLReconcile] Summary:', JSON.stringify(summary, null, 2));
}

main()
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PositionPnLReconcile] Failed:', msg);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
