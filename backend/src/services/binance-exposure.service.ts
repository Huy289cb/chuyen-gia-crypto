/**
 * Live Binance Futures exposure (source of truth for stacking prevention).
 */

import { getPositionRisk } from './binance/account';
import {
  findBinancePositionForSide,
  listActiveBinancePositions,
  type ParsedBinancePosition,
  type PositionSideLocal,
} from '../utils/binance-position-match';

export async function fetchBinancePositionRiskRows(symbol?: string): Promise<
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
  const rows = await getPositionRisk(symbolUsdt);
  return Array.isArray(rows) ? rows : [];
}

export async function fetchActiveBinancePositions(symbol?: string): Promise<ParsedBinancePosition[]> {
  const rows = await fetchBinancePositionRiskRows(symbol);
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
  return match !== null && match.positionAmt >= 1e-8;
}
