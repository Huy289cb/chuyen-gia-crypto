/**
 * Resolve close price / realized PnL from Binance userTrades (fill-accurate).
 */

import { getUserTrades } from './binance/trading';

export interface FillPnlResolution {
  closePrice: number;
  realizedPnl: number;
  closeQty: number;
  tradeIds: number[];
  verified: boolean;
  source: 'user_trades' | 'mark_estimate';
}

export interface UserTradeRow {
  orderId: number;
  side: string;
  price: number;
  qty: number;
  commission: number;
  realizedPnl: number;
  time: number;
}

function pairSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/USDT$/, '');
  return `${s}USDT`;
}

function isCloseSide(positionSide: string, tradeSide: string): boolean {
  const long = positionSide.toLowerCase() === 'long' || positionSide.toLowerCase() === 'buy';
  const buy = tradeSide.toUpperCase() === 'BUY';
  return long ? !buy : buy;
}

/**
 * Fetch trades in [entryTime, closeTime] and aggregate closing fills.
 */
export async function resolveClosePnlFromUserTrades(params: {
  symbol: string;
  side: string;
  entryTime: Date;
  closeTime?: Date;
  entryOrderId?: string | null;
  sizeQty: number;
  entryPrice: number;
  fallbackClosePrice: number;
}): Promise<FillPnlResolution> {
  const fallback: FillPnlResolution = {
    closePrice: params.fallbackClosePrice,
    realizedPnl: 0,
    closeQty: 0,
    tradeIds: [],
    verified: false,
    source: 'mark_estimate',
  };

  if (process.env.BINANCE_ENABLED !== 'true') {
    const qty = Math.abs(params.sizeQty);
    fallback.realizedPnl = estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, qty);
    return fallback;
  }

  const closeTime = params.closeTime ?? new Date();
  const startMs = params.entryTime.getTime() - 60_000;
  const endMs = closeTime.getTime() + 60_000;

  let trades: UserTradeRow[];
  try {
    const raw = await getUserTrades(pairSymbol(params.symbol), {
      startTime: startMs,
      endTime: endMs,
      limit: 1000,
    });
    trades = raw as UserTradeRow[];
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[BinanceFillPnl] userTrades fetch failed: ${msg}`);
    const qty = Math.abs(params.sizeQty);
    fallback.realizedPnl = estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, qty);
    return fallback;
  }

  if (trades.length === 0) {
    const qty = Math.abs(params.sizeQty);
    fallback.realizedPnl = estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, qty);
    return fallback;
  }

  const entryOrderId = params.entryOrderId ? String(params.entryOrderId) : null;

  const closeTrades = trades.filter((t) => {
    if (!isCloseSide(params.side, t.side)) return false;
    if (entryOrderId && String(t.orderId) === entryOrderId) return false;
    return t.time >= params.entryTime.getTime();
  });

  if (closeTrades.length === 0) {
    const qty = Math.abs(params.sizeQty);
    fallback.realizedPnl = estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, qty);
    return fallback;
  }

  let sumQty = 0;
  let sumNotional = 0;
  let sumPnl = 0;
  let sumCommission = 0;
  const tradeIds: number[] = [];

  for (const t of closeTrades) {
    sumQty += t.qty;
    sumNotional += t.price * t.qty;
    sumPnl += t.realizedPnl;
    sumCommission += t.commission;
    tradeIds.push(t.orderId);
  }

  const closePrice = sumQty > 0 ? sumNotional / sumQty : params.fallbackClosePrice;
  const targetQty = Math.abs(params.sizeQty);
  const qtyTol = Math.max(targetQty * 0.05, 1e-6);
  if (sumQty > 0 && targetQty > 0 && Math.abs(sumQty - targetQty) > qtyTol) {
    console.warn(
      `[BinanceFillPnl] Close qty ${sumQty.toFixed(6)} ≠ position ${targetQty.toFixed(6)} — skip verified PnL`
    );
    const qty = Math.abs(params.sizeQty);
    fallback.realizedPnl = estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, qty);
    return fallback;
  }

  const hasBinancePnl = closeTrades.some((t) => Math.abs(t.realizedPnl) > 1e-12);
  const realizedPnl = hasBinancePnl
    ? sumPnl - sumCommission
    : estimatePnl(params.side, params.entryPrice, closePrice, sumQty || Math.abs(params.sizeQty));

  return {
    closePrice,
    realizedPnl,
    closeQty: sumQty,
    tradeIds,
    verified: sumQty > 1e-8,
    source: 'user_trades',
  };
}

export function estimatePnl(side: string, entry: number, close: number, qty: number): number {
  const raw = (close - entry) * Math.abs(qty);
  const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
  return isLong ? raw : -raw;
}
