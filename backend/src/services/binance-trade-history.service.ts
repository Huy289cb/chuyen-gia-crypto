/**
 * Closed trade rounds reconstructed from Binance Futures userTrades (source of truth).
 */

import { getUserTrades } from './binance/trading';

export interface BinanceTradeRound {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  closePrice: number;
  quantity: number;
  fee: number;
  realizedPnL: number;
  closeReason: string;
  status: 'closed';
  closedAt: string;
}

interface RoundBuilder {
  side: 'long' | 'short';
  entryValue: number;
  entryQty: number;
  exitValue: number;
  exitQty: number;
  pnl: number;
  fee: number;
  openTime: number;
  closeTime: number;
}

type UserTradeRow = {
  side: string;
  price: number;
  qty: number;
  commission: number;
  realizedPnl: number;
  time: number;
  orderId: number | string;
};

function pairSymbol(symbol: string): string {
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  return `${base}USDT`;
}

/** Aggregate chronological fills into closed position rounds (ONE_WAY). */
export function aggregateUserTradesToRounds(
  trades: UserTradeRow[],
  symbol: string
): BinanceTradeRound[] {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const rounds: BinanceTradeRound[] = [];
  let net = 0;
  let current: RoundBuilder | null = null;

  const finalize = (builder: RoundBuilder): BinanceTradeRound => {
    const entryPrice = builder.entryQty > 0 ? builder.entryValue / builder.entryQty : 0;
    const closePrice = builder.exitQty > 0 ? builder.exitValue / builder.exitQty : entryPrice;
    return {
      id: `binance_${builder.closeTime}_${builder.side}`,
      symbol: symbol.toUpperCase().replace(/USDT$/i, ''),
      side: builder.side,
      entryPrice,
      closePrice,
      quantity: builder.entryQty,
      fee: Math.abs(builder.fee),
      realizedPnL: builder.pnl,
      closeReason: 'binance_fills',
      status: 'closed',
      closedAt: new Date(builder.closeTime).toISOString(),
    };
  };

  for (const t of sorted) {
    const delta = t.side.toUpperCase() === 'BUY' ? t.qty : -t.qty;
    const prevNet = net;
    net += delta;

    if (prevNet === 0 && net !== 0) {
      current = {
        side: net > 0 ? 'long' : 'short',
        entryValue: 0,
        entryQty: 0,
        exitValue: 0,
        exitQty: 0,
        pnl: 0,
        fee: 0,
        openTime: t.time,
        closeTime: t.time,
      };
    }

    if (current) {
      current.fee += Math.abs(t.commission);
      current.pnl += t.realizedPnl;
      current.closeTime = t.time;

      const adding =
        prevNet === 0 ||
        (prevNet > 0 && delta > 0) ||
        (prevNet < 0 && delta < 0);

      if (adding) {
        current.entryValue += t.price * Math.abs(delta);
        current.entryQty += Math.abs(delta);
      } else {
        current.exitValue += t.price * Math.abs(delta);
        current.exitQty += Math.abs(delta);
      }
    }

    if (current && net === 0) {
      rounds.push(finalize(current));
      current = null;
    } else if (current && prevNet !== 0 && net !== 0 && Math.sign(prevNet) !== Math.sign(net)) {
      // Flipped through zero in one fill — close prior round at this trade, start new
      rounds.push(finalize(current));
      current = {
        side: net > 0 ? 'long' : 'short',
        entryValue: t.price * Math.abs(net),
        entryQty: Math.abs(net),
        exitValue: 0,
        exitQty: 0,
        pnl: 0,
        fee: 0,
        openTime: t.time,
        closeTime: t.time,
      };
    }
  }

  return rounds.reverse();
}

export async function fetchBinanceClosedTradeRounds(
  symbol: string,
  limit = 20
): Promise<BinanceTradeRound[]> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return [];
  }

  const symbolUsdt = pairSymbol(symbol);
  const lookbackMs = 90 * 24 * 3600 * 1000;
  const raw = await getUserTrades(symbolUsdt, {
    startTime: Date.now() - lookbackMs,
    limit: 1000,
  });

  const rounds = aggregateUserTradesToRounds(raw as UserTradeRow[], symbol);
  return rounds.slice(0, limit);
}
