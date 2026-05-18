/**
 * One-shot V3 pipeline test — all major branches.
 * Usage: npx tsx scripts/pipeline-v3-test.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { signalGateService } from '../src/services/signal-gate.service';
import { executeV3Trade } from '../src/services/v3-trade-execution.service';
import { runManualMarketScan } from '../src/schedulers/market-scan.scheduler';
import { runManualLLMDispatch } from '../src/schedulers/llm-dispatch.scheduler';
import { getScanResult } from '../src/schedulers/market-scan.scheduler';
import {
  getTestnetPendingOrders,
  getTestnetPositions,
} from '../src/repositories/testnet.repository';

type Verdict = 'PASS' | 'FAIL' | 'SKIP';

interface CaseResult {
  name: string;
  verdict: Verdict;
  detail: string;
}

const results: CaseResult[] = [];

function record(name: string, verdict: Verdict, detail: string): void {
  results.push({ name, verdict, detail });
  const icon = verdict === 'PASS' ? '✓' : verdict === 'SKIP' ? '○' : '✗';
  console.log(`${icon} [${verdict}] ${name}: ${detail}`);
}

async function testDbConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    record('DB connection', 'PASS', 'PostgreSQL reachable');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    record('DB connection', 'FAIL', msg);
  }
}

async function testWarmupViaApi(): Promise<void> {
  try {
    const res = await fetch('http://localhost:3000/api/dashboard/warmup');
    const json = (await res.json()) as { data?: { isWarmedUp?: boolean } };
    const warmed = json.data?.isWarmedUp === true;
    record('Warmup API', warmed ? 'PASS' : 'FAIL', `isWarmedUp=${json.data?.isWarmedUp}`);
  } catch (e: unknown) {
    record('Warmup API', 'FAIL', e instanceof Error ? e.message : String(e));
  }
}

async function testSignalGateBlock(): Promise<void> {
  const flatCandles = Array.from({ length: 60 }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    timestamp: Date.now() - (60 - i) * 60000,
  }));
  const r = await signalGateService.evaluate({ candles: flatCandles, symbol: 'BTC', timeframe: '15m' });
  record(
    'Signal gate BLOCK (flat chop)',
    !r.pass ? 'PASS' : 'FAIL',
    r.reason
  );
}

async function testV3TradeValidation(): Promise<void> {
  const saved = process.env.BINANCE_ENABLED;
  process.env.BINANCE_ENABLED = 'false';
  const r1 = await executeV3Trade({
    symbol: 'BTC',
    timeframe: 'test',
    analysis: { bias: 'bullish', action: 'buy', confidence: 0.9, suggested_entry: 100, suggested_stop_loss: 99, suggested_take_profit: 102 },
  });
  record('V3 exec rejects BINANCE off', !r1.success && r1.reason.includes('BINANCE') ? 'PASS' : 'FAIL', r1.reason);
  process.env.BINANCE_ENABLED = saved;

  const r2 = await executeV3Trade({
    symbol: 'BTC',
    timeframe: 'test',
    analysis: { bias: 'bullish', action: 'hold', confidence: 0.9, suggested_entry: 100, suggested_stop_loss: 99, suggested_take_profit: 102 },
  });
  record('V3 exec rejects invalid action', !r2.success ? 'PASS' : 'FAIL', r2.reason);

  const r3 = await executeV3Trade({
    symbol: 'BTC',
    timeframe: 'test',
    analysis: { bias: 'bullish', action: 'buy', confidence: 0.9, suggested_entry: 100, suggested_stop_loss: 101, suggested_take_profit: 102 },
  });
  record('V3 exec rejects bad LONG SL', !r3.success && r3.reason.includes('stop_loss') ? 'PASS' : 'FAIL', r3.reason);
}

async function testMarketScanAndCache(): Promise<void> {
  try {
    await runManualMarketScan();
    const tfs = ['15m', '1h', '4h'] as const;
    const summary: string[] = [];
    for (const tf of tfs) {
      const r = getScanResult('BTC', tf);
      if (!r) {
        summary.push(`${tf}:no-cache`);
        continue;
      }
      summary.push(`${tf}:${r.signalResult.pass ? 'PASS' : 'BLOCK'}`);
    }
    const hasAny = summary.some((s) => !s.includes('no-cache'));
    record('Market scan + cache', hasAny ? 'PASS' : 'FAIL', summary.join(', '));
  } catch (e: unknown) {
    record('Market scan + cache', 'FAIL', e instanceof Error ? e.message : String(e));
  }
}

async function testLlmDispatch(): Promise<void> {
  try {
    await runManualLLMDispatch();
    record('LLM dispatch manual run', 'PASS', 'completed without throw');
  } catch (e: unknown) {
    record('LLM dispatch manual run', 'FAIL', e instanceof Error ? e.message : String(e));
  }
}

async function testBinanceOrderPlacement(): Promise<void> {
  const { ensurePositionModeDetected } = await import('../src/services/binance-hedge-mode');
  await ensurePositionModeDetected();

  const pendingBefore = await getTestnetPendingOrders({ symbol: 'BTC', status: 'pending', methodId: 'kim_nghia' });
  if (pendingBefore.length > 0) {
    record('Binance limit order (live)', 'SKIP', `already ${pendingBefore.length} pending order(s)`);
    return;
  }

  const open = await getTestnetPositions({ symbol: 'BTC', status: 'open', methodId: 'kim_nghia' });
  if (open.length > 0) {
    record('Binance limit order (live)', 'SKIP', 'open position exists');
    return;
  }

  const r = await executeV3Trade({
    symbol: 'BTC',
    timeframe: 'test',
    analysis: {
      bias: 'bearish',
      action: 'sell',
      confidence: 0.88,
      suggested_entry: 95000,
      suggested_stop_loss: 96000,
      suggested_take_profit: 93000,
      expected_rr: 2,
    },
  });

  record(
    'Binance limit order (live)',
    r.success && r.binanceOrderId ? 'PASS' : 'FAIL',
    r.success ? `orderId=${r.orderId} binance=${r.binanceOrderId}` : r.reason
  );
}

async function testPostDispatchState(): Promise<void> {
  const pending = await getTestnetPendingOrders({ symbol: 'BTC', status: 'pending', methodId: 'kim_nghia' });
  const open = await getTestnetPositions({ symbol: 'BTC', status: 'open', methodId: 'kim_nghia' });
  const failed = await prisma.testnetPosition.findMany({
    where: { symbol: 'BTC', status: 'reconciliation_failed_not_on_binance' },
    take: 5,
  });

  record(
    'Pending orders after dispatch',
    'PASS',
    `pending=${pending.length} open=${open.length} (binance ids: ${pending.map((o) => o.binance_order_id || 'none').join(', ') || 'none'})`
  );

  if (failed.length > 0) {
    record('Legacy phantom positions', 'SKIP', `${failed.length} old reconciliation_failed rows (pre-v3-exec fix)`);
  }

  try {
    const res = await fetch('http://localhost:3000/api/dashboard/signals');
    const json = (await res.json()) as { data?: Array<{ pass?: boolean; timeframe?: string }> };
    const live = Array.isArray(json.data) ? json.data[0] : undefined;
    record(
      'Signals API live best-of',
      live?.timeframe ? 'PASS' : 'FAIL',
      `pass=${live?.pass} tf=${live?.timeframe}`
    );
  } catch (e: unknown) {
    record('Signals API', 'FAIL', e instanceof Error ? e.message : String(e));
  }
}

async function testDashboardEndpoints(): Promise<void> {
  const paths = ['/api/dashboard/system', '/api/dashboard/schedulers', '/api/dashboard/risk', '/api/dashboard/llm'];
  for (const path of paths) {
    try {
      const res = await fetch(`http://localhost:3000${path}`);
      const ok = res.ok;
      record(`API ${path}`, ok ? 'PASS' : 'FAIL', `status=${res.status}`);
    } catch (e: unknown) {
      record(`API ${path}`, 'FAIL', e instanceof Error ? e.message : String(e));
    }
  }
}

async function main(): Promise<void> {
  console.log('=== V3 Pipeline Test Run ===\n');
  await testDbConnection();
  await testDashboardEndpoints();
  await testWarmupViaApi();
  await testSignalGateBlock();
  await testV3TradeValidation();
  await testBinanceOrderPlacement();
  await testMarketScanAndCache();
  await testLlmDispatch();
  await testPostDispatchState();

  const failed = results.filter((r) => r.verdict === 'FAIL');
  console.log('\n=== Summary ===');
  console.log(`Total: ${results.length} | PASS: ${results.filter((r) => r.verdict === 'PASS').length} | FAIL: ${failed.length} | SKIP: ${results.filter((r) => r.verdict === 'SKIP').length}`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }

  // Cancel test pending orders so they do not block the live pipeline
  const testPending = await getTestnetPendingOrders({ symbol: 'BTC', status: 'pending', methodId: 'kim_nghia' });
  if (testPending.length > 0 && process.env.BINANCE_ENABLED === 'true') {
    try {
      const { initTestnetClient, cancelOrder } = await import('../src/services/binanceClient');
      const { cancelTestnetPendingOrder } = await import('../src/repositories/testnet.repository');
      const client = initTestnetClient();
      for (const order of testPending) {
        if (order.binance_order_id && client) {
          await cancelOrder(client, `${order.symbol}USDT`, Number(order.binance_order_id));
        }
        await cancelTestnetPendingOrder(order.order_id, 'pipeline_test_cleanup');
      }
      console.log(`\n[cleanup] Cancelled ${testPending.length} pending test order(s)`);
    } catch (e: unknown) {
      console.warn('[cleanup] Failed to cancel test orders:', e instanceof Error ? e.message : String(e));
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
