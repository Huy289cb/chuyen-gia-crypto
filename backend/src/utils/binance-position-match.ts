/**
 * Normalize Binance positionRisk rows for ONE_WAY (positionSide BOTH) and HEDGE modes.
 */

export type PositionSideLocal = 'long' | 'short';

export interface ParsedBinancePosition {
  symbol: string;
  symbolUsdt: string;
  side: PositionSideLocal;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  /** From Binance positionRisk unRealizedProfit when available. */
  unRealizedProfit?: number;
  /** Signed notional USDT from Binance when available. */
  notional?: number;
  rawPositionSide: string;
}

const MIN_AMT = 1e-8;

export function localSideFromPositionAmt(amt: number): PositionSideLocal | null {
  if (!Number.isFinite(amt) || Math.abs(amt) < MIN_AMT) return null;
  return amt > 0 ? 'long' : 'short';
}

export function parseBinancePositionRisk(row: {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  notional?: string | number;
  positionSide?: string;
}): ParsedBinancePosition | null {
  const symbolUsdt = String(row.symbol ?? '').toUpperCase();
  if (!symbolUsdt) return null;

  const positionAmt = parseFloat(String(row.positionAmt ?? '0'));
  const side = localSideFromPositionAmt(positionAmt);
  if (!side) return null;

  const entryPrice = parseFloat(String(row.entryPrice ?? '0'));
  const markPrice = parseFloat(String(row.markPrice ?? '0'));
  const unRealizedProfit = parseFloat(String(row.unRealizedProfit ?? 'NaN'));
  const notional = parseFloat(String(row.notional ?? 'NaN'));

  return {
    symbol: symbolUsdt.replace(/USDT$/i, ''),
    symbolUsdt,
    side,
    positionAmt: Math.abs(positionAmt),
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
    markPrice: Number.isFinite(markPrice) ? markPrice : 0,
    unRealizedProfit: Number.isFinite(unRealizedProfit) ? unRealizedProfit : undefined,
    notional: Number.isFinite(notional) ? notional : undefined,
    rawPositionSide: String(row.positionSide ?? 'BOTH').toUpperCase(),
  };
}

export function findBinancePositionForSide(
  rows: Array<{
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    positionSide?: string;
  }>,
  symbol: string,
  side: PositionSideLocal
): ParsedBinancePosition | null {
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  for (const row of rows) {
    const parsed = parseBinancePositionRisk(row);
    if (parsed && parsed.symbol === base && parsed.side === side) {
      return parsed;
    }
  }
  return null;
}

export function listActiveBinancePositions(
  rows: Array<{
    symbol?: string;
    positionAmt?: string | number;
    entryPrice?: string | number;
    markPrice?: string | number;
    positionSide?: string;
  }>
): ParsedBinancePosition[] {
  const out: ParsedBinancePosition[] = [];
  for (const row of rows) {
    const parsed = parseBinancePositionRisk(row);
    if (parsed) out.push(parsed);
  }
  return out;
}
