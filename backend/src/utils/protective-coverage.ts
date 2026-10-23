import type { ParsedBinancePosition } from './binance-position-match';

export interface ProtectiveAlgoLike {
  symbol?: string;
  side?: string;
  type?: string;
  orderType?: string;
  algoId?: string | number;
  orderId?: string | number;
  quantity?: number;
  origQty?: number;
  positionSide?: string;
}

export interface ProtectiveCoverage {
  stopLossId: string | null;
  takeProfitId: string | null;
  stopLossCount: number;
  takeProfitCount: number;
}

function pairSymbol(symbol: string): string {
  return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}

function algoId(order: ProtectiveAlgoLike): string | null {
  const id = order.algoId ?? order.orderId;
  return id == null ? null : String(id);
}

function algoType(order: ProtectiveAlgoLike): string {
  return String(order.orderType ?? order.type ?? '').toUpperCase();
}

function isMatchingPositionSide(order: ProtectiveAlgoLike, position: ParsedBinancePosition): boolean {
  const ps = String(order.positionSide ?? '').toUpperCase();
  if (!ps || ps === 'BOTH') return true;
  return ps === (position.side === 'long' ? 'LONG' : 'SHORT');
}

export function classifyProtectiveCoverage(
  position: ParsedBinancePosition,
  orders: ProtectiveAlgoLike[]
): ProtectiveCoverage {
  const closeSide = position.side === 'long' ? 'SELL' : 'BUY';
  const symbolUsdt = pairSymbol(position.symbol);
  const coverage: ProtectiveCoverage = {
    stopLossId: null,
    takeProfitId: null,
    stopLossCount: 0,
    takeProfitCount: 0,
  };

  for (const order of orders) {
    if (String(order.symbol ?? '').toUpperCase() !== symbolUsdt) continue;
    if (String(order.side ?? '').toUpperCase() !== closeSide) continue;
    if (!isMatchingPositionSide(order, position)) continue;

    const t = algoType(order);
    const id = algoId(order);
    if (!id) continue;
    if (t.includes('TAKE_PROFIT')) {
      coverage.takeProfitCount += 1;
      coverage.takeProfitId ??= id;
    } else if (t.includes('STOP')) {
      coverage.stopLossCount += 1;
      coverage.stopLossId ??= id;
    }
  }

  return coverage;
}

