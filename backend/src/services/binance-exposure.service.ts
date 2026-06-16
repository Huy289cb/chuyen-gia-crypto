/**
 * Live Binance Futures exposure (source of truth for stacking prevention).
 */

import { getPositionRisk } from './binance/account';
import { getUserTrades, getOpenAlgoOrders } from './binance/trading';
import { isBinanceDemoMetadataUnavailableError } from './binance-account-health.service';
import {
  findBinancePositionForSide,
  listActiveBinancePositions,
  type ParsedBinancePosition,
  type PositionSideLocal,
} from '../utils/binance-position-match';

const MIN_AMT = 1e-8;

let positionRiskUnavailable = false;

/** True when positionRisk returned demo -1109 and fallback sources were used. */
export function isBinancePositionRiskUnavailable(): boolean {
  return positionRiskUnavailable;
}

/** Reset exposure probe state (tests). */
export function clearBinancePositionRiskState(): void {
  positionRiskUnavailable = false;
}

function pairSymbol(symbol: string): string {
  return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}

function isProtectiveAlgoOrder(order: {
  orderType?: string;
  type?: string;
}): boolean {
  const t = String(order.orderType ?? order.type ?? '').toUpperCase();
  return t.includes('STOP') || t.includes('TAKE_PROFIT');
}

function protectiveSideToLocal(side: string): PositionSideLocal {
  return side.toUpperCase() === 'SELL' ? 'long' : 'short';
}

/**
 * Infer open exposure when positionRisk/account are unavailable on demo (-1109).
 * Uses userTrades net qty, then open algo SL/TP as secondary signal.
 */
export async function inferBinancePositionsFromFallback(
  symbol?: string
): Promise<ParsedBinancePosition[]> {
  const symbolUsdt = symbol ? pairSymbol(symbol) : 'BTCUSDT';
  const base = symbolUsdt.replace(/USDT$/i, '');

  let netAmt = 0;
  let lastPrice = 0;
  try {
    const trades = await getUserTrades(symbolUsdt, { limit: 1000 });
    const sorted = [...trades].sort((a, b) => a.time - b.time);
    for (const t of sorted) {
      const signed = t.side === 'BUY' ? t.qty : -t.qty;
      netAmt += signed;
      if (t.price > 0) lastPrice = t.price;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[BinanceExposure] userTrades fallback failed for ${symbolUsdt}: ${msg}`);
  }

  if (Math.abs(netAmt) >= MIN_AMT) {
    const side: PositionSideLocal = netAmt > 0 ? 'long' : 'short';
    return [
      {
        symbol: base,
        symbolUsdt,
        side,
        positionAmt: Math.abs(netAmt),
        entryPrice: lastPrice,
        markPrice: lastPrice,
        rawPositionSide: 'BOTH',
      },
    ];
  }

  try {
    const algos = await getOpenAlgoOrders(symbolUsdt);
    const protective = algos.filter(isProtectiveAlgoOrder);
    if (protective.length === 0) return [];

    const side = protectiveSideToLocal(String(protective[0].side ?? ''));
    const qty = Math.max(
      ...protective.map((o) => Number(o.quantity ?? o.origQty ?? 0))
    );
    if (qty < MIN_AMT) return [];

    const trigger =
      Number(protective[0].triggerPrice ?? protective[0].stopPrice ?? protective[0].price ?? 0) ||
      lastPrice;

    return [
      {
        symbol: base,
        symbolUsdt,
        side,
        positionAmt: qty,
        entryPrice: trigger,
        markPrice: trigger,
        rawPositionSide: 'BOTH',
      },
    ];
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[BinanceExposure] openAlgoOrders fallback failed for ${symbolUsdt}: ${msg}`);
    return [];
  }
}

function parsedToRiskRow(position: ParsedBinancePosition): {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  positionSide: string;
} {
  const signedAmt = position.side === 'short' ? -position.positionAmt : position.positionAmt;
  return {
    symbol: position.symbolUsdt,
    positionAmt: signedAmt,
    entryPrice: position.entryPrice,
    markPrice: position.markPrice,
    positionSide: position.rawPositionSide,
  };
}

export type BinanceExposureFetchOpts = {
  /** When false, return empty on demo -1109 instead of inferring from userTrades net. */
  allowUserTradesFallback?: boolean;
};

export async function fetchBinancePositionRiskRows(
  symbol?: string,
  opts?: BinanceExposureFetchOpts
): Promise<
  Array<{
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    positionSide?: string;
  }>
> {
  const symbolUsdt = symbol
    ? `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`
    : null;
  const allowFallback = opts?.allowUserTradesFallback !== false;
  positionRiskUnavailable = false;
  try {
    const rows = await getPositionRisk(symbolUsdt);
    return Array.isArray(rows) ? rows : [];
  } catch (error: unknown) {
    if (isBinanceDemoMetadataUnavailableError(error)) {
      positionRiskUnavailable = true;
      if (!allowFallback) {
        console.warn(
          '[BinanceExposure] positionRisk unavailable on demo (-1109); strict mode — no userTrades fallback'
        );
        return [];
      }
      console.warn(
        '[BinanceExposure] positionRisk unavailable on demo (-1109); falling back to userTrades/openAlgoOrders'
      );
      const inferred = await inferBinancePositionsFromFallback(symbol);
      return inferred.map(parsedToRiskRow);
    }
    throw error;
  }
}

export async function fetchActiveBinancePositions(
  symbol?: string,
  opts?: BinanceExposureFetchOpts
): Promise<ParsedBinancePosition[]> {
  const rows = await fetchBinancePositionRiskRows(symbol, opts);
  return listActiveBinancePositions(rows);
}

export async function fetchBinanceNetPosition(
  symbol: string
): Promise<ParsedBinancePosition | null> {
  const rows = await fetchBinancePositionRiskRows(symbol);
  const active = listActiveBinancePositions(rows);
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  return active.find((p) => p.symbol === base) ?? null;
}

export async function hasBinanceExposureForSide(
  symbol: string,
  side: PositionSideLocal
): Promise<boolean> {
  const rows = await fetchBinancePositionRiskRows(symbol);
  const match = findBinancePositionForSide(rows, symbol, side);
  return match !== null && match.positionAmt >= MIN_AMT;
}
