/**
 * Fix wallet vs DB gap using Binance income + wallet snapshot.
 *
 * Usage:
 *   cd backend && npm run testnet:reconcile-wallet
 *   npm run testnet:reconcile-wallet -- --cleanup-algo
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import {
  reconcileTestnetWalletBySymbol,
  removePipelineAnchorOutcome,
} from '../src/services/wallet-reconcile.service';
import { cleanupOrphanBinanceAlgoOrders } from '../src/services/binance-reconciliation';

async function main(): Promise<void> {
  const symbol = process.env.RECONCILE_SYMBOL ?? 'BTC';
  const methodId = process.env.RECONCILE_METHOD_ID ?? 'kim_nghia';
  const cleanupAlgo = process.argv.includes('--cleanup-algo');

  if (process.env.BINANCE_ENABLED !== 'true') {
    throw new Error('BINANCE_ENABLED must be true');
  }

  const removed = await removePipelineAnchorOutcome();
  if (removed) {
    console.log(`[WalletReconcile] Removed pipeline anchor outcome id=${removed}`);
  }

  const result = await reconcileTestnetWalletBySymbol(symbol, methodId);
  if (!result) {
    throw new Error(`No account for ${symbol}/${methodId}`);
  }

  console.log('[WalletReconcile] Result:', JSON.stringify(result, null, 2));

  if (cleanupAlgo) {
    const cleaned = await cleanupOrphanBinanceAlgoOrders(symbol);
    console.log(`[WalletReconcile] Cancelled ${cleaned} orphan algo order(s) on Binance`);
  }
}

main()
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[WalletReconcile] Failed:', msg);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
