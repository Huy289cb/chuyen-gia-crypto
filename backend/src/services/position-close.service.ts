import {commitAtomicVerifiedClose} from '../utils/atomic-verified-close';
import {randomUUID} from 'node:crypto';
import {observePositionCloseWrite} from '../utils/position-close-write-observation';
import { buildCloseAccountUpdate, shouldUpdateClosedAccount } from '../utils/close-account-update';
/**
 * Close local testnet positions and optionally mirror closes on Binance.
 */

/** Close reasons when protective SL/TP placement fails or price already past levels. */
export const PROTECTIVE_CLOSE_REASON = {
  SL_BREACHED: 'protective_sl_breached_market',
  TP_REACHED: 'protective_tp_reached_market',
  FAILED: 'protective_failed_market_close',
} as const;

export type ProtectiveCloseReason =
  (typeof PROTECTIVE_CLOSE_REASON)[keyof typeof PROTECTIVE_CLOSE_REASON];

import { prisma } from '../lib/prisma';
import {
  closeTestnetPosition,
  recordTestnetTradeEvent,
  updateTestnetPosition,
} from '../repositories/testnet.repository';
import { ensurePositionModeDetected, getPositionMode } from './binance-hedge-mode';
import { normalizeQuantityForSymbol, placeMarketOrder } from './binanceClient';
import { syncTestnetAccountFromBinance, resolveTestnetAccountBalances } from './binance-balance-sync.service';
import {
  recordTradeOutcomeOnClose,
  type CloseOutcomeContext,
} from './trade-outcome.service';
import { getPositionRisk } from './binanceClient';
import { applyConsecutiveLossCooldownIfNeeded } from './account-risk-guard.service';
import { resolveClosePnlFromUserTrades } from './binance-fill-pnl.service';
import { resolveVerifiedCloseReason } from './close-reason-resolve.service';
import { hasBinanceFillProof } from '../utils/binance-fill-proof';
import { isBookkeepingCloseReason } from '../utils/bookkeeping-close';

export { hasBinanceFillProof } from '../utils/binance-fill-proof';

export function calculatePnl(side: string, entry: number, close: number, qty: number): number {
  const raw = (close - entry) * Math.abs(qty);
  const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
  return isLong ? raw : -raw;
}

/**
 * Close duplicate DB row when consolidating exposure (records PnL + outcome).
 */
export async function closeDuplicateForMerge(
  positionId: string,
  primaryPositionId: string
): Promise<void> {
  const full = await prisma.testnetPosition.findUnique({
    where: { position_id: positionId },
    include: { account: true },
  });

  if (!full || full.status !== 'open' || !full.account) {
    return;
  }

  const closePrice = full.current_price > 0 ? full.current_price : full.entry_price;
  await closeLocalPosition(
    {
      ...full,
      account: { current_balance: full.account.current_balance },
    },
    closePrice,
    `merged_into_${primaryPositionId}`,
    { merged_into: primaryPositionId }
  );
}

export async function findOpenPositionByBinanceOrderId(
  binanceOrderId: string
): Promise<any | null> {
  return prisma.testnetPosition.findFirst({
    where: {
      status: 'open',
      OR: [
        { binance_order_id: binanceOrderId },
        { binance_sl_order_id: binanceOrderId },
        { binance_tp_order_id: binanceOrderId },
      ],
    },
    include: { account: true },
  });
}

/**
 * Close DB position, update account stats, record event.
 */
export async function closeLocalPosition(
  position: {
    position_id: string;
    account_id: number;
    side: string;
    entry_price: number;
    entry_time?: Date;
    size_qty: number;
    partial_closed?: number;
    stop_loss?: number;
    take_profit?: number;
    expected_rr?: number;
    risk_usd?: number;
    entry_fee?: number;
    exit_fee?: number;
    funding_fee?: number;
    symbol?: string;
    status?: string;
    binance_order_id?: string | null;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
    account: { current_balance: number };
  },
  closePrice: number,
  closeReason: string,
  eventMeta?: Record<string, unknown>
): Promise<number> {
  if (position.status === 'closed') {
    console.warn(`[PositionClose] ${position.position_id} already closed — skip`);
    return 0;
  }

  const hasFillProof = hasBinanceFillProof(position);
  const isBookkeepingClose =
    !hasFillProof &&
    (eventMeta?.bookkeeping_close === true ||
      eventMeta?.stale_ghost === true ||
      closeReason === 'reconciliation_closed_not_on_binance' ||
      isBookkeepingCloseReason(closeReason));

  const needsBinanceProof =
    closeReason === 'stop_loss' || closeReason === 'take_profit';
  if (needsBinanceProof && process.env.BINANCE_ENABLED === 'true') {
    const hasProof =
      typeof eventMeta?.binance_order_id === 'string' ||
      eventMeta?.verified_binance_zero === true;
    if (!hasProof) {
      console.warn(
        `[PositionClose] Block unverified ${closeReason} close for ${position.position_id} — require Binance fill or verified zero`
      );
      return 0;
    }
  }

  const qty = Math.abs(position.size_qty);
  let finalClosePrice = closePrice;
  let realizedPnl = 0;
  let finalCloseReason = closeReason;
  let fillVerified = false;
  let fillSource: string | undefined;
  let fillTradeIds: number[] = [];
  let fillCloseQty = qty;
  let entryFee = position.entry_fee ?? 0;
  let exitFee = position.exit_fee ?? 0;
  let fundingFee = position.funding_fee ?? 0;

  if (isBookkeepingClose) {
    finalCloseReason = 'reconciliation_bookkeeping';
    realizedPnl = 0;
  } else {
    const fill = await resolveClosePnlFromUserTrades({
      symbol: position.symbol ?? 'BTC',
      side: position.side,
      entryTime: position.entry_time ?? new Date(Date.now() - 3_600_000),
      closeTime: new Date(),
      entryOrderId: position.binance_order_id ?? null,
      sizeQty: position.size_qty,
      partialReduction: position.partial_closed === 1,
      entryPrice: position.entry_price,
      fallbackClosePrice: closePrice,
      onEvidence: evidence => {
        void Promise.resolve().then(() => recordTestnetTradeEvent(position.position_id, 'close_round_query_observed', evidence as Record<string, unknown>))
          .catch(() => console.warn('[PositionClose] Round query journal persistence failed'));
      },
    });

    finalClosePrice = fill.verified ? fill.closePrice : closePrice;
    realizedPnl = fill.verified
      ? fill.realizedPnl
      : process.env.BINANCE_ENABLED === 'true' ? 0 : calculatePnl(position.side, position.entry_price, finalClosePrice, qty);
    finalCloseReason = fill.verified
      ? resolveVerifiedCloseReason(closeReason, eventMeta, position)
      : closeReason;
    fillVerified = fill.verified;
    fillSource = fill.source;
    fillTradeIds = fill.tradeIds;
    fillCloseQty = fill.closeQty || qty;
    if (fill.verified) {
      entryFee = fill.entryFee ?? 0; exitFee = fill.exitFee ?? 0; fundingFee = fill.fundingFee ?? 0;
    }
  }

  if (fillVerified && !isBookkeepingClose) {
    const committed = await commitAtomicVerifiedClose(prisma, {
      positionId: position.position_id, accountId: position.account_id,
      closePrice: finalClosePrice, closeReason: finalCloseReason, realizedPnl,
      entryFee, exitFee, fundingFee,
      walletAuthoritative: process.env.BINANCE_ENABLED === 'true',
    });
    if (committed.status !== 'committed') return 0;
    void Promise.resolve().then(() => recordTestnetTradeEvent(position.position_id,
      'atomic_verified_close_committed', committed.receipt))
      .catch(() => console.warn('[PositionClose] Atomic close journal persistence failed'));
  } else {
  const closeWriteIdentity = { close_attempt_id: randomUUID(), account_id: position.account_id,
    position_id: position.position_id, fill_verified: fillVerified, bookkeeping: isBookkeepingClose };
  const publishCloseWrite = (data: Record<string, unknown>) => recordTestnetTradeEvent(position.position_id, 'position_close_write_observed', data);
  await observePositionCloseWrite('close_status', closeWriteIdentity,
    { position_id: position.position_id, close_price: finalClosePrice, close_reason: finalCloseReason },
    () => closeTestnetPosition(position.position_id, finalClosePrice, finalCloseReason), publishCloseWrite);
  const closeFinancialInput = {
    current_price: finalClosePrice,
    realized_pnl: realizedPnl,
    entry_fee: entryFee, exit_fee: exitFee, funding_fee: fundingFee,
    unrealized_pnl: 0,
  };
  await observePositionCloseWrite('close_financial_update', closeWriteIdentity, closeFinancialInput,
    () => updateTestnetPosition(position.position_id, closeFinancialInput), publishCloseWrite);

  if (shouldUpdateClosedAccount(isBookkeepingClose, fillVerified, process.env.BINANCE_ENABLED === 'true')) {
    const walletAuthoritative = position.partial_closed === 1 && process.env.BINANCE_ENABLED === 'true';
    const accountUpdate = buildCloseAccountUpdate({ walletAuthoritative, balance: position.account.current_balance, realizedPnl,
      lastTradeTime: new Date(), updatedAt: new Date() });

    const recordedAccountUpdate = JSON.parse(JSON.stringify({
      schema: 'close-account-update-v1', account_id: position.account_id,
      input: { balance: position.account.current_balance, realized_pnl: realizedPnl,
        bookkeeping: isBookkeepingClose, fill_verified: fillVerified, binance_enabled: process.env.BINANCE_ENABLED === 'true', wallet_authoritative: walletAuthoritative,
        last_trade_time: accountUpdate.last_trade_time.toISOString(), updated_at: accountUpdate.updated_at.toISOString() },
      update: accountUpdate,
    }));
    await prisma.testnetAccount.update({
      where: { id: position.account_id },
      data: accountUpdate,
    });
    // Capture DB return time before scheduling telemetry or starting wallet sync.
    const accountAppliedAt = new Date().toISOString();
    // Record successful local DB write only; subsequent wallet sync is separate evidence.
    void Promise.resolve().then(() => recordTestnetTradeEvent(position.position_id, 'close_account_update_applied',
      { ...recordedAccountUpdate, applied_at: accountAppliedAt, applied_clock_source: 'db_update_return' }))
      .catch(() => console.warn('[PositionClose] Account update journal persistence failed'));
  }

  }

  if (process.env.BINANCE_ENABLED === 'true') {
    try {
      await syncTestnetAccountFromBinance(position.account_id, evidence => {
        void Promise.resolve().then(() => recordTestnetTradeEvent(position.position_id, 'wallet_sync_observed', evidence))
          .catch(() => console.warn('[PositionClose] Wallet sync journal persistence failed'));
      });
    } catch (syncErr: unknown) {
      const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
      console.warn(`[PositionClose] Binance balance sync before notify failed: ${msg}`);
    }
  }

  const balances = await resolveTestnetAccountBalances(position.account_id, false);

  await recordTestnetTradeEvent(position.position_id, 'position_closed', {
    symbol: position.symbol ?? 'BTC',
    side: position.side,
    entry_price: position.entry_price,
    size_qty: qty,
    size_usd: qty * finalClosePrice,
    close_price: finalClosePrice,
    close_reason: finalCloseReason,
    realized_pnl: realizedPnl,
    account_balance: balances.account_balance,
    account_equity: balances.account_equity,
    fill_verified: fillVerified,
    fill_source: fillSource,
    binance_fill_ids: fillVerified && !isBookkeepingClose ? fillTradeIds : [],
    close_qty: fillVerified && !isBookkeepingClose ? fillCloseQty : qty,
    ...(isBookkeepingClose ? { suppress_telegram: true, bookkeeping_close: true } : {}),
    ...eventMeta,
  });

  console.log(
    `[PositionClose] Closed ${position.position_id} @ ${finalClosePrice.toFixed(2)} (${finalCloseReason}) ` +
      `PnL=${realizedPnl.toFixed(2)}` +
      (isBookkeepingClose ? ' [bookkeeping]' : ` fill=${fillSource ?? 'n/a'} verified=${fillVerified}`)
  );

  if (isBookkeepingClose || (process.env.BINANCE_ENABLED === 'true' && !fillVerified)) {
    return realizedPnl;
  }

  const isLoss = realizedPnl < 0;
  const outcomeCtx: CloseOutcomeContext = {
    position_id: position.position_id,
    symbol: position.symbol ?? 'BTC',
    side: position.side,
    entry_price: position.entry_price,
    entry_time: position.entry_time ?? new Date(),
    stop_loss: position.stop_loss ?? position.entry_price,
    take_profit: position.take_profit ?? position.entry_price,
    expected_rr: position.expected_rr ?? 0,
    risk_usd: position.risk_usd ?? 0,
    entry_fee: entryFee,
    exit_fee: exitFee,
    funding_fee: fundingFee,
    close_reason: finalCloseReason,
    decision_id:
      typeof eventMeta?.decision_id === 'number' ? eventMeta.decision_id : undefined,
    fill_verified: fillVerified,
  };
  await recordTradeOutcomeOnClose(outcomeCtx, finalClosePrice, realizedPnl, {
    skipReflection: !fillVerified,
  });

  if (isLoss) {
    await applyConsecutiveLossCooldownIfNeeded(
      position.account_id,
      position.symbol ?? 'BTC'
    );
  }

  return realizedPnl;
}

/**
 * Market-close on Binance (full or partial qty).
 */
export interface BinanceCloseResult {
  ok: boolean;
  reason?: string;
  normalizedQty?: number;
}

export interface BinanceMarketCloseOptions {
  guardSource?: string;
  bypassLifecycleGuard?: boolean;
  positionId?: string;
  entryTime?: Date | null;
}

export async function closePositionOnBinanceMarket(
  position: { symbol: string; side: string; size_qty: number },
  closeQty?: number,
  options?: BinanceMarketCloseOptions
): Promise<BinanceCloseResult> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return { ok: true, reason: 'binance_disabled' };
  }

  if (!options?.bypassLifecycleGuard) {
    const { shouldDeferEmergencyMarketClose } = await import(
      './position-lifecycle-guard.service'
    );
    const defer = await shouldDeferEmergencyMarketClose({
      symbol: position.symbol,
      side: position.side,
      source: options?.guardSource ?? 'closePositionOnBinanceMarket',
      positionId: options?.positionId,
      entryTime: options?.entryTime,
    });
    if (defer.defer) {
      return {
        ok: false,
        reason: `lifecycle_guard: ${defer.reason ?? 'deferred'}`,
      };
    }
  }

  await ensurePositionModeDetected();

  const qty = Math.abs(closeQty ?? position.size_qty);
  if (qty <= 0) {
    return { ok: false, reason: 'close quantity <= 0' };
  }

  const symbol = `${position.symbol.toUpperCase()}USDT`;
  const qtyCheck = await normalizeQuantityForSymbol(symbol, qty);
  if (!qtyCheck.valid) {
    return { ok: false, reason: qtyCheck.reason ?? 'invalid close quantity after normalization' };
  }

  const normalizedQty = qtyCheck.normalizedQty;
  const isLong = position.side.toLowerCase() === 'long';
  const binanceSide = isLong ? 'SELL' : 'BUY';
  const mode = getPositionMode();
  const currentPosition = {
    positionAmt: isLong ? normalizedQty : -normalizedQty,
    ...(mode === 'HEDGE'
      ? { positionSide: isLong ? 'LONG' : 'SHORT' }
      : {}),
  };

  try {
    await placeMarketOrder(
      {},
      symbol,
      binanceSide,
      normalizedQty,
      'CLOSE',
      currentPosition,
      null
    );
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }

  console.log(
    `[PositionClose] Binance market close ${symbol} ${binanceSide} qty=${normalizedQty} (raw ${qty})`
  );

  if (!options?.bypassLifecycleGuard) {
    const emergencySources = new Set([
      'protective_exposure_audit',
      'protective_failed_market_close',
      'position_monitor_unhedged',
    ]);
    if (options?.guardSource && emergencySources.has(options.guardSource)) {
      const { noteEmergencyMarketClose } = await import('./position-lifecycle-guard.service');
      noteEmergencyMarketClose(position.symbol, position.side, options.guardSource);
    }
  }

  return { ok: true, normalizedQty };
}

export async function closeOpenPositionFromBinanceFill(
  binanceOrderId: string,
  orderType: string,
  executedQty: number,
  avgPrice: number,
  _symbolUsdt: string
): Promise<boolean> {
  if (avgPrice <= 0 || executedQty <= 0) return false;

  const position = await findOpenPositionByBinanceOrderId(binanceOrderId);

  if (!position) {
    console.warn(
      `[PositionClose] No open position matched binance order ${binanceOrderId} — skip phantom close`
    );
    return false;
  }

  const closeReason =
    orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT'
      ? 'take_profit'
      : orderType === 'STOP_MARKET' || orderType === 'STOP'
        ? 'stop_loss'
        : 'binance_close';

  await closeLocalPosition(position, avgPrice, closeReason, {
    binance_order_id: binanceOrderId,
    order_type: orderType,
    executed_qty: executedQty,
  });
  return true;
}

/**
 * Sync ACCOUNT_UPDATE when Binance reports zero position amount.
 */
export async function syncClosedPositionsFromAccountUpdate(
  positions: Array<{ s?: string; pa?: string; ps?: string }>
): Promise<void> {
  if (!positions?.length) return;

  for (const p of positions) {
    const amt = parseFloat(p.pa ?? '0');
    if (Math.abs(amt) > 1e-8) continue;

    const symbol = (p.s ?? '').replace('USDT', '');
    const ps = (p.ps ?? '').toLowerCase();
    const side = ps === 'long' ? 'long' : ps === 'short' ? 'short' : null;
    if (!symbol || !side) continue;

    const open = await prisma.testnetPosition.findFirst({
      where: { status: 'open', symbol, side },
      include: { account: true },
    });
    if (!open) continue;

    if (process.env.BINANCE_ENABLED === 'true') {
      try {
        const risks = await getPositionRisk({} as object, `${symbol}USDT`);
        const live = risks.find(
          (r: { positionSide?: string; positionAmt?: string }) =>
            String(r.positionSide).toUpperCase() === (side === 'long' ? 'LONG' : 'SHORT')
        );
        const liveAmt = Math.abs(parseFloat(live?.positionAmt ?? '0'));
        if (liveAmt > 1e-8) {
          console.warn(
            `[PositionClose] ACCOUNT_UPDATE zero ${symbol} ${side} but Binance still has ${liveAmt} — skip DB close`
          );
          continue;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[PositionClose] Binance verify failed for ${symbol} ${side}: ${msg} — skip close`);
        continue;
      }
    }

    const mark = open.current_price > 0 ? open.current_price : open.entry_price;
    await closeLocalPosition(open, mark, 'account_update_zero_position', {
      binance_position_side: ps,
      verified_binance_zero: true,
    });
  }
}
