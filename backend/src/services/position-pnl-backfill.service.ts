/**
 * Backfill close_price / realized_pnl / trade_outcomes for historical DB rows.
 */

import { prisma } from '../lib/prisma';
import {
  closeTestnetPosition,
  PIPELINE_EVENT_POSITION_ID,
  updateTestnetPosition,
} from '../repositories/testnet.repository';
import { syncTestnetAccountFromBinance } from './binance-balance-sync.service';
import {
  recordTradeOutcomeOnClose,
  type CloseOutcomeContext,
} from './trade-outcome.service';

export function calculatePositionPnl(
  side: string,
  entry: number,
  close: number,
  qty: number
): number {
  const raw = (close - entry) * Math.abs(qty);
  const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
  return isLong ? raw : -raw;
}

export function resolveBackfillClosePrice(position: {
  close_price: number | null;
  current_price: number;
  entry_price: number;
}): number {
  if (position.close_price != null && position.close_price > 0) {
    return position.close_price;
  }
  if (position.current_price > 0) {
    return position.current_price;
  }
  return position.entry_price;
}

export interface BackfillPositionResult {
  position_id: string;
  skipped: boolean;
  close_price?: number;
  realized_pnl?: number;
  outcome_stored?: boolean;
  reason?: string;
}

export interface BackfillRunSummary {
  scanned: number;
  updated: number;
  outcomes: number;
  skipped: number;
  dry_run: boolean;
  results: BackfillPositionResult[];
}

function needsBackfill(position: {
  close_price: number | null;
  realized_pnl: number;
}): boolean {
  const pnlMissing = Math.abs(position.realized_pnl) < 0.01;
  const priceMissing = position.close_price == null || position.close_price <= 0;
  return pnlMissing || priceMissing;
}

/**
 * Backfill one closed (or closing) position row without double-counting live closes.
 */
export async function backfillClosedPositionPnl(
  position: {
    position_id: string;
    account_id: number;
    symbol: string;
    side: string;
    entry_price: number;
    entry_time: Date;
    current_price: number;
    close_price: number | null;
    close_time: Date | null;
    close_reason: string | null;
    size_qty: number;
    stop_loss: number;
    take_profit: number;
    expected_rr: number;
    risk_usd: number;
    entry_fee?: number;
    exit_fee?: number;
    funding_fee?: number;
    status: string;
    realized_pnl: number;
  },
  options?: { dryRun?: boolean }
): Promise<BackfillPositionResult> {
  if (!needsBackfill(position)) {
    return {
      position_id: position.position_id,
      skipped: true,
      reason: 'already_has_pnl',
    };
  }

  const closePrice = resolveBackfillClosePrice(position);
  const qty = Math.abs(position.size_qty);
  const realizedPnl = calculatePositionPnl(
    position.side,
    position.entry_price,
    closePrice,
    qty
  );

  if (options?.dryRun) {
    return {
      position_id: position.position_id,
      skipped: false,
      close_price: closePrice,
      realized_pnl: realizedPnl,
      reason: 'dry_run',
    };
  }

  const closeReason = position.close_reason ?? 'backfill_pnl';
  const closeTime = position.close_time ?? new Date();

  if (position.status === 'open') {
    await closeTestnetPosition(position.position_id, closePrice, closeReason);
  }

  await updateTestnetPosition(position.position_id, {
    close_price: closePrice,
    close_time: closeTime,
    close_reason: closeReason,
    current_price: closePrice,
    realized_pnl: realizedPnl,
    unrealized_pnl: 0,
    status: 'closed',
  });

  const outcomeCtx: CloseOutcomeContext = {
    position_id: position.position_id,
    symbol: position.symbol,
    side: position.side,
    entry_price: position.entry_price,
    entry_time: position.entry_time,
    stop_loss: position.stop_loss,
    take_profit: position.take_profit,
    expected_rr: position.expected_rr,
    risk_usd: position.risk_usd,
    entry_fee: position.entry_fee,
    exit_fee: position.exit_fee,
    funding_fee: position.funding_fee,
    close_reason: closeReason,
  };

  await recordTradeOutcomeOnClose(outcomeCtx, closePrice, realizedPnl);

  return {
    position_id: position.position_id,
    skipped: false,
    close_price: closePrice,
    realized_pnl: realizedPnl,
    outcome_stored: true,
  };
}

/**
 * Recompute account trade counters from closed positions (after batch backfill).
 */
export async function recomputeTestnetAccountTradeStats(accountId: number): Promise<void> {
  const closed = await prisma.testnetPosition.findMany({
    where: {
      account_id: accountId,
      status: 'closed',
      position_id: { not: PIPELINE_EVENT_POSITION_ID },
      side: { notIn: ['NONE', 'none'] },
      size_qty: { gt: 0 },
    },
  });

  let wins = 0;
  let losses = 0;
  let totalRealized = 0;

  for (const p of closed) {
    const pnl = Number(p.realized_pnl) || 0;
    totalRealized += pnl;
    if (pnl > 0.01) wins += 1;
    else if (pnl < -0.01) losses += 1;
  }

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      total_trades: closed.length,
      winning_trades: wins,
      losing_trades: losses,
      realized_pnl: totalRealized,
      updated_at: new Date(),
    },
  });

  if (process.env.BINANCE_ENABLED === 'true') {
    await syncTestnetAccountFromBinance(accountId);
  }
}

/**
 * Backfill all closed positions for an account that lack PnL/close_price.
 */
export async function runTestnetPnlBackfill(options?: {
  symbol?: string;
  methodId?: string;
  dryRun?: boolean;
}): Promise<BackfillRunSummary> {
  const symbol = options?.symbol ?? 'BTC';
  const methodId = options?.methodId ?? 'kim_nghia';
  const dryRun = options?.dryRun ?? false;

  const account = await prisma.testnetAccount.findFirst({
    where: { symbol, method_id: methodId },
  });

  if (!account) {
    throw new Error(`No testnet account for ${symbol}/${methodId}`);
  }

  const candidates = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: 'closed',
      position_id: { not: PIPELINE_EVENT_POSITION_ID },
      side: { notIn: ['NONE', 'none'] },
      size_qty: { gt: 0 },
    },
    orderBy: { close_time: 'asc' },
  });

  const summary: BackfillRunSummary = {
    scanned: candidates.length,
    updated: 0,
    outcomes: 0,
    skipped: 0,
    dry_run: dryRun,
    results: [],
  };

  for (const position of candidates) {
    if (!needsBackfill(position)) {
      summary.skipped += 1;
      summary.results.push({
        position_id: position.position_id,
        skipped: true,
        reason: 'already_has_pnl',
      });
      continue;
    }

    const result = await backfillClosedPositionPnl(position, { dryRun });
    summary.results.push(result);

    if (result.skipped) {
      summary.skipped += 1;
    } else {
      summary.updated += 1;
      if (result.outcome_stored) summary.outcomes += 1;
    }
  }

  if (!dryRun && summary.updated > 0) {
    await recomputeTestnetAccountTradeStats(account.id);
  }

  return summary;
}
