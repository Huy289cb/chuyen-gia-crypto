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

// Below Binance BTCUSDT min lot (0.001). Rounds smaller than this come from
// over-closing by a hair / float drift, not real positions — drop them.
const DUST_QTY = 5e-4;

/**
 * Aggregate chronological fills into closed position rounds (ONE_WAY).
 *
 * Rounds are delimited by Binance's per-fill realizedPnl, NOT by a running net
 * position: a fill with realizedPnl == 0 opens/adds; a fill with realizedPnl != 0
 * reduces/closes. A new round begins when an opening fill appears after the
 * current round has already had a closing fill. This avoids phantom rounds from
 * accumulated quantity drift when entry/exit fills don't cancel exactly.
 */
export function aggregateUserTradesToRounds(
  trades: UserTradeRow[],
  symbol: string
): BinanceTradeRound[] {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const rounds: BinanceTradeRound[] = [];
  let current: RoundBuilder | null = null;
  let seenClose = false;

  const finalize = (builder: RoundBuilder): BinanceTradeRound => {
    const entryPrice = builder.entryQty > 0 ? builder.entryValue / builder.entryQty : 0;
    const closePrice = builder.exitQty > 0 ? builder.exitValue / builder.exitQty : entryPrice;
    const quantity = builder.entryQty > 0 ? builder.entryQty : builder.exitQty;
    return {
      id: `binance_${builder.closeTime}_${builder.side}`,
      symbol: symbol.toUpperCase().replace(/USDT$/i, ''),
      side: builder.side,
      entryPrice: entryPrice > 0 ? entryPrice : closePrice,
      closePrice,
      quantity,
      fee: Math.abs(builder.fee),
      realizedPnL: builder.pnl,
      closeReason: 'binance_fills',
      status: 'closed',
      closedAt: new Date(builder.closeTime).toISOString(),
    };
  };

  const newBuilder = (side: 'long' | 'short', time: number): RoundBuilder => ({
    side,
    entryValue: 0,
    entryQty: 0,
    exitValue: 0,
    exitQty: 0,
    pnl: 0,
    fee: 0,
    openTime: time,
    closeTime: time,
  });

  for (const t of sorted) {
    const dir: 'long' | 'short' = t.side.toUpperCase() === 'BUY' ? 'long' : 'short';
    const reducing = Math.abs(t.realizedPnl) > 1e-9;

    if (!current) {
      // First fill: if it reduces, the opening leg is outside the window, so the
      // position side is opposite the reducing fill's direction.
      current = newBuilder(reducing ? (dir === 'long' ? 'short' : 'long') : dir, t.time);
      seenClose = false;
    } else if (!reducing && seenClose) {
      // Opening fill after the current round already closed → previous round done.
      rounds.push(finalize(current));
      current = newBuilder(dir, t.time);
      seenClose = false;
    }

    current.fee += Math.abs(t.commission);
    current.closeTime = t.time;

    if (reducing) {
      current.pnl += t.realizedPnl;
      current.exitValue += t.price * Math.abs(t.qty);
      current.exitQty += Math.abs(t.qty);
      seenClose = true;
    } else {
      current.entryValue += t.price * Math.abs(t.qty);
      current.entryQty += Math.abs(t.qty);
    }
  }

  // A trailing round with no closing fill is the still-open position — exclude it.
  if (current && seenClose) {
    rounds.push(finalize(current));
  }

  return rounds.filter((r) => r.quantity >= DUST_QTY).reverse();
}

export interface BinanceLossStreak {
  /** Number of most-recent consecutive losing rounds (net of fees). */
  consecutiveLosses: number;
  /** Epoch ms of the most recent losing round, 0 if none. */
  lastLossTime: number;
}

/** Count leading consecutive losing rounds (net of fees). Rounds must be newest-first. */
export function computeLossStreakFromRounds(rounds: BinanceTradeRound[]): BinanceLossStreak {
  let consecutiveLosses = 0;
  let lastLossTime = 0;

  for (const r of rounds) {
    const net = r.realizedPnL - Math.abs(r.fee);
    if (net < 0) {
      consecutiveLosses += 1;
      if (lastLossTime === 0) lastLossTime = new Date(r.closedAt).getTime();
    } else {
      break;
    }
  }

  return { consecutiveLosses, lastLossTime };
}

/**
 * Loss streak from Binance closed rounds (source of truth). Used by the risk
 * guard because DB consecutive_losses freezes when positions close as
 * reconciliation bookkeeping (PnL=0).
 */
export async function getBinanceLossStreak(
  symbol: string,
  lookback = 20
): Promise<BinanceLossStreak> {
  const rounds = await fetchBinanceClosedTradeRounds(symbol, lookback);
  return computeLossStreakFromRounds(rounds);
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
  const cutoff = Date.now() - lookbackMs;

  // Demo/testnet userTrades often returns [] when startTime is set — fetch recent fills
  // without time filter, then apply lookback on aggregated closed rounds.
  const raw = await getUserTrades(symbolUsdt, { limit: 1000 });

  const rounds = aggregateUserTradesToRounds(raw as UserTradeRow[], symbol).filter(
    (r) => new Date(r.closedAt).getTime() >= cutoff
  );
  return rounds.slice(0, limit);
}
