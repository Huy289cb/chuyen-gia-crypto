/**
 * Reset V3 trading state + OHLCV for 5m stack experiment.
 * Keeps testnet account row; syncs wallet from Binance when enabled.
 *
 * Usage: cd backend && npx tsx scripts/v3-reset-for-5m.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import {
  cancelAllOrders,
  getAccountBalance,
  getOpenOrders,
  getPositionRisk,
  normalizeQuantityForSymbol,
  placeMarketOrder,
} from '../src/services/binanceClient';
import { ensurePositionModeDetected } from '../src/services/binance-hedge-mode';

async function flattenBinanceBtc(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    console.log('[Reset] BINANCE_ENABLED not true — skip Binance flatten');
    return;
  }

  await ensurePositionModeDetected();
  const client = {};

  try {
    const orders = await getOpenOrders(client, 'BTCUSDT');
    if (orders.length > 0) {
      console.log(`[Reset] Cancelling ${orders.length} open order(s) on BTCUSDT...`);
      await cancelAllOrders(client, 'BTCUSDT');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Reset] Cancel orders warning: ${msg}`);
  }

  const positions = await getPositionRisk(client, 'BTCUSDT');
  for (const p of positions) {
    const amt = parseFloat(p.positionAmt ?? '0');
    if (Math.abs(amt) < 1e-8) continue;

    const side = String(p.positionSide ?? '').toUpperCase();
    const isLong = side === 'LONG' || amt > 0;
    const qty = Math.abs(amt);
    const qtyCheck = await normalizeQuantityForSymbol('BTCUSDT', qty);
    if (!qtyCheck.valid || qtyCheck.normalizedQty <= 0) {
      console.warn(`[Reset] Skip close — invalid qty ${qty}`);
      continue;
    }

    const binanceSide = isLong ? 'SELL' : 'BUY';
    const positionSide = isLong ? 'LONG' : 'SHORT';
    console.log(`[Reset] Market close ${positionSide} qty=${qtyCheck.normalizedQty}`);
    await placeMarketOrder(
      client,
      'BTCUSDT',
      binanceSide,
      qtyCheck.normalizedQty,
      'CLOSE',
      { positionAmt: amt, positionSide },
      positionSide
    );
  }
}

async function fetchWalletBalance(): Promise<number> {
  if (process.env.BINANCE_ENABLED === 'true') {
    const info = await getAccountBalance({});
    const wallet = parseFloat(info?.totalWalletBalance ?? '0');
    if (Number.isFinite(wallet) && wallet > 0) {
      return wallet;
    }
  }

  const account = await prisma.testnetAccount.findFirst({
    where: { symbol: 'BTC', method_id: 'kim_nghia' },
  });
  return Number(account?.current_balance ?? account?.starting_balance ?? 0);
}

async function wipeV3Data(): Promise<void> {
  await prisma.$transaction([
    prisma.tradeReflection.deleteMany(),
    prisma.tradeOutcome.deleteMany(),
    prisma.tradeDecision.deleteMany(),
    prisma.playbookStats.deleteMany(),
    prisma.testnetTradeEvent.deleteMany(),
    prisma.testnetPendingOrder.deleteMany(),
    prisma.testnetPosition.deleteMany(),
    prisma.testnetAccountSnapshot.deleteMany(),
    prisma.schedulerHeartbeat.deleteMany(),
    prisma.ohlcvCandle.deleteMany({ where: { coin: 'BTC' } }),
  ]);
  console.log('[Reset] Cleared trade_decisions, testnet state, scheduler heartbeats, BTC OHLCV');
}

async function resetTestnetAccountBalance(wallet: number): Promise<void> {
  const updated = await prisma.testnetAccount.updateMany({
    where: { symbol: 'BTC', method_id: 'kim_nghia' },
    data: {
      starting_balance: wallet,
      current_balance: wallet,
      equity: wallet,
      unrealized_pnl: 0,
      realized_pnl: 0,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      max_drawdown: 0,
      consecutive_losses: 0,
      last_trade_time: null,
      cooldown_until: null,
      updated_at: new Date(),
    },
  });
  console.log(`[Reset] testnet_accounts updated (${updated.count} row(s)), wallet=${wallet.toFixed(2)} USDT`);
}

async function main(): Promise<void> {
  console.log('[Reset] V3 5m stack — DB wipe + wallet sync');
  await flattenBinanceBtc();
  const wallet = await fetchWalletBalance();
  await wipeV3Data();
  await resetTestnetAccountBalance(wallet);
  console.log('[Reset] Done. Restart worker to warm 5m/15m/1h candles.');
}

main()
  .catch((err) => {
    console.error('[Reset] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
