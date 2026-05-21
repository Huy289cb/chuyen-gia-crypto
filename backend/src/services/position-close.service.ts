/**
 * Close local testnet positions and optionally mirror closes on Binance.
 */

import { prisma } from '../lib/prisma';
import {
  closeTestnetPosition,
  recordTestnetTradeEvent,
  updateTestnetPosition,
} from '../repositories/testnet.repository';
import { ensurePositionModeDetected } from './binance-hedge-mode';
import { normalizeQuantityForSymbol, placeMarketOrder } from './binanceClient';

function calculatePnl(side: string, entry: number, close: number, qty: number): number {
  const raw = (close - entry) * Math.abs(qty);
  const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
  return isLong ? raw : -raw;
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
    size_qty: number;
    account: { current_balance: number };
  },
  closePrice: number,
  closeReason: string,
  eventMeta?: Record<string, unknown>
): Promise<number> {
  const qty = Math.abs(position.size_qty);
  const realizedPnl = calculatePnl(position.side, position.entry_price, closePrice, qty);

  await closeTestnetPosition(position.position_id, closePrice, closeReason);
  await updateTestnetPosition(position.position_id, {
    current_price: closePrice,
    realized_pnl: realizedPnl,
    unrealized_pnl: 0,
  });

  const isWin = realizedPnl > 0;
  await prisma.testnetAccount.update({
    where: { id: position.account_id },
    data: {
      current_balance: position.account.current_balance + realizedPnl,
      equity: position.account.current_balance + realizedPnl,
      unrealized_pnl: 0,
      realized_pnl: { increment: realizedPnl },
      total_trades: { increment: 1 },
      winning_trades: { increment: isWin ? 1 : 0 },
      losing_trades: { increment: isWin ? 0 : 1 },
      consecutive_losses: isWin ? 0 : { increment: 1 },
      last_trade_time: new Date(),
      updated_at: new Date(),
    },
  });

  await recordTestnetTradeEvent(position.position_id, 'position_closed', {
    close_price: closePrice,
    close_reason: closeReason,
    realized_pnl: realizedPnl,
    ...eventMeta,
  });

  console.log(
    `[PositionClose] Closed ${position.position_id} @ ${closePrice} (${closeReason}) PnL=${realizedPnl.toFixed(2)}`
  );
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

export async function closePositionOnBinanceMarket(
  position: { symbol: string; side: string; size_qty: number },
  closeQty?: number
): Promise<BinanceCloseResult> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return { ok: true, reason: 'binance_disabled' };
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
  const positionSide = isLong ? 'LONG' : 'SHORT';
  const currentPosition = {
    positionAmt: isLong ? normalizedQty : -normalizedQty,
    positionSide,
  };

  await placeMarketOrder(
    {},
    symbol,
    binanceSide,
    normalizedQty,
    'CLOSE',
    currentPosition,
    positionSide
  );

  console.log(
    `[PositionClose] Binance market close ${symbol} ${binanceSide} qty=${normalizedQty} (raw ${qty})`
  );
  return { ok: true, normalizedQty };
}

export async function closeOpenPositionFromBinanceFill(
  binanceOrderId: string,
  orderType: string,
  executedQty: number,
  avgPrice: number,
  symbolUsdt: string
): Promise<boolean> {
  if (avgPrice <= 0 || executedQty <= 0) return false;

  let position = await findOpenPositionByBinanceOrderId(binanceOrderId);

  if (!position) {
    const symbol = symbolUsdt.replace('USDT', '');
    position = await prisma.testnetPosition.findFirst({
      where: { status: 'open', symbol },
      include: { account: true },
    });
  }

  if (!position) return false;

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

    const mark = open.current_price > 0 ? open.current_price : open.entry_price;
    await closeLocalPosition(open, mark, 'account_update_zero_position', {
      binance_position_side: ps,
    });
  }
}
