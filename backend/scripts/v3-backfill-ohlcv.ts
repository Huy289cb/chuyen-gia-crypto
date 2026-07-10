/**
 * Backfill OHLCV from Binance history for V3 warmup targets.
 *
 * Usage:
 *   cd backend && npx tsx scripts/v3-backfill-ohlcv.ts
 *   npx tsx scripts/v3-backfill-ohlcv.ts --timeframe 5m --limit 2000
 */

import 'dotenv/config';
import { getV3WarmupRequiredCandles, getV3WarmupTimeframes } from '../src/config/v3-schedulers';
import {
  backfillOhlcvIfNeeded,
  backfillOhlcvTimeframe,
} from '../src/services/ohlcv-backfill.service';

function parseArgs(): { symbol: string; timeframe?: string; limit?: number } {
  const args = process.argv.slice(2);
  let symbol = 'BTC';
  let timeframe: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) {
      symbol = args[++i];
    } else if (args[i] === '--timeframe' && args[i + 1]) {
      timeframe = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  return { symbol, timeframe, limit };
}

async function main(): Promise<void> {
  const { symbol, timeframe, limit } = parseArgs();

  if (timeframe) {
    const targets = getV3WarmupRequiredCandles();
    const target = limit ?? targets[timeframe] ?? 500;
    const result = await backfillOhlcvTimeframe(symbol, timeframe, target);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`[Backfill] Gate TFs: ${getV3WarmupTimeframes().join(', ')}`);
  console.log(`[Backfill] Targets:`, getV3WarmupRequiredCandles());

  const result = await backfillOhlcvIfNeeded(symbol);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('[Backfill] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    const { disconnectPrisma } = await import('../src/lib/prisma');
    await disconnectPrisma();
  });
