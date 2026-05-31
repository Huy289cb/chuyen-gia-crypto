/**
 * Backfill close_price, realized_pnl, trade_outcomes for historical testnet positions.
 *
 * Usage:
 *   cd backend && npm run testnet:backfill-pnl
 *   npm run testnet:backfill-pnl -- --dry-run
 */

import 'dotenv/config';
import { runTestnetPnlBackfill } from '../src/services/position-pnl-backfill.service';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const symbol = process.env.BACKFILL_SYMBOL ?? 'BTC';
  const methodId = process.env.BACKFILL_METHOD_ID ?? 'kim_nghia';

  console.log(`[BackfillPnL] Starting symbol=${symbol} method=${methodId} dryRun=${dryRun}`);

  const summary = await runTestnetPnlBackfill({ symbol, methodId, dryRun });

  console.log('[BackfillPnL] Summary:', JSON.stringify(summary, null, 2));

  for (const r of summary.results) {
    if (!r.skipped && r.realized_pnl != null) {
      console.log(
        `  ${r.position_id}: close=${r.close_price?.toFixed(2)} pnl=${r.realized_pnl.toFixed(2)}`
      );
    }
  }

  if (dryRun) {
    console.log('[BackfillPnL] Dry run — no DB writes');
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[BackfillPnL] Failed:', msg);
  process.exit(1);
});
