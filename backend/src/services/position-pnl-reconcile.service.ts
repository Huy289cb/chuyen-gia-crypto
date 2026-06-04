/**
 * Re-backfill closed position PnL from Binance userTrades.
 */

import { prisma } from '../lib/prisma';
import { PIPELINE_EVENT_POSITION_ID, updateTestnetPosition } from '../repositories/testnet.repository';
import { resolveClosePnlFromUserTrades } from './binance-fill-pnl.service';
import { recomputeTestnetAccountTradeStats } from './position-pnl-backfill.service';
import { reconcileTestnetWalletFromBinance } from './wallet-reconcile.service';
import { resolveVerifiedCloseReason } from './close-reason-resolve.service';

export interface PositionPnlReconcileResult {
  position_id: string;
  skipped: boolean;
  reason?: string;
  old_pnl?: number;
  new_pnl?: number;
  verified?: boolean;
}

export interface PositionPnlReconcileSummary {
  scanned: number;
  updated: number;
  verified: number;
  dry_run: boolean;
  results: PositionPnlReconcileResult[];
}

export async function reconcileClosedPositionPnlFromFills(
  position: {
    position_id: string;
    account_id: number;
    symbol: string;
    side: string;
    entry_price: number;
    entry_time: Date;
    close_time: Date | null;
    close_price: number | null;
    current_price: number;
    realized_pnl: number;
    size_qty: number;
    close_reason: string | null;
    binance_order_id: string | null;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
  },
  options?: { dryRun?: boolean }
): Promise<PositionPnlReconcileResult> {
  const fallbackClose =
    position.close_price && position.close_price > 0
      ? position.close_price
      : position.current_price > 0
        ? position.current_price
        : position.entry_price;

  const fill = await resolveClosePnlFromUserTrades({
    symbol: position.symbol,
    side: position.side,
    entryTime: position.entry_time,
    closeTime: position.close_time ?? new Date(),
    entryOrderId: position.binance_order_id,
    sizeQty: position.size_qty,
    entryPrice: position.entry_price,
    fallbackClosePrice: fallbackClose,
  });

  if (!fill.verified) {
    return {
      position_id: position.position_id,
      skipped: true,
      reason: 'no_close_fills',
      old_pnl: position.realized_pnl,
    };
  }

  const oldPnl = position.realized_pnl;
  const newPnl = fill.realizedPnl;
  const closeReason = resolveVerifiedCloseReason(
    position.close_reason ?? 'reconciliation_fill',
    { fill_verified: true },
    position
  );

  if (options?.dryRun) {
    return {
      position_id: position.position_id,
      skipped: false,
      old_pnl: oldPnl,
      new_pnl: newPnl,
      verified: true,
      reason: 'dry_run',
    };
  }

  await updateTestnetPosition(position.position_id, {
    close_price: fill.closePrice,
    realized_pnl: newPnl,
    current_price: fill.closePrice,
    close_reason: closeReason,
  });

  return {
    position_id: position.position_id,
    skipped: false,
    old_pnl: oldPnl,
    new_pnl: newPnl,
    verified: true,
  };
}

export async function runClosedPositionPnlReconcile(options?: {
  symbol?: string;
  methodId?: string;
  dryRun?: boolean;
}): Promise<PositionPnlReconcileSummary> {
  const symbol = options?.symbol ?? 'BTC';
  const methodId = options?.methodId ?? 'kim_nghia';
  const dryRun = options?.dryRun ?? false;

  const account = await prisma.testnetAccount.findFirst({
    where: { symbol, method_id: methodId },
  });
  if (!account) {
    throw new Error(`No account for ${symbol}/${methodId}`);
  }

  const positions = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: 'closed',
      position_id: { not: PIPELINE_EVENT_POSITION_ID },
      side: { notIn: ['NONE', 'none'] },
      size_qty: { gt: 0 },
    },
    orderBy: { close_time: 'asc' },
  });

  const summary: PositionPnlReconcileSummary = {
    scanned: positions.length,
    updated: 0,
    verified: 0,
    dry_run: dryRun,
    results: [],
  };

  for (const position of positions) {
    const result = await reconcileClosedPositionPnlFromFills(position, { dryRun });
    summary.results.push(result);
    if (result.verified) summary.verified += 1;
    if (!result.skipped && result.reason !== 'dry_run') summary.updated += 1;
  }

  if (!dryRun && summary.updated > 0) {
    await recomputeTestnetAccountTradeStats(account.id);
    if (process.env.BINANCE_ENABLED === 'true') {
      await reconcileTestnetWalletFromBinance(account.id);
    }
  }

  return summary;
}
