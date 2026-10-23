/**
 * Closed trade rounds reconstructed from Binance Futures userTrades (source of truth).
 */

import { getUserTrades } from './binance/trading';
import { reconstructExchangeRounds, type ExchangeFill as UserTradeRow } from '../utils/exchange-rounds';
import { fetchBinanceIncomeRows } from './binance-income.service';

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
  openedAt?: string;
  fundingFee?: number;
  netPnl?: number;
}

function pairSymbol(symbol: string): string {
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  return `${base}USDT`;
}

// Below Binance BTCUSDT min lot (0.001). Rounds smaller than this come from
// over-closing by a hair / float drift, not real positions — drop them.
const DUST_QTY = 5e-4;
const USER_TRADES_LOOKBACK_MS = 90 * 24 * 3600 * 1000;
// Binance limits Account Trade List queries to a seven-day time range and,
// when no time range is supplied, returns only the latest seven days. Query
// explicit, non-overlapping windows so an idle week does not erase the latest
// loss streak or make the dashboard history look empty.
const USER_TRADES_WINDOW_MS = 7 * 24 * 3600 * 1000;
const USER_TRADES_CACHE_TTL_MS = 60_000;

type CachedRounds = {
  expiresAt: number;
  rounds: BinanceTradeRound[];
};

const roundsCache = new Map<string, CachedRounds>();

export interface BinanceTradeHistoryFetchOptions {
  nowMs?: number;
  lookbackMs?: number;
  cacheTtlMs?: number;
}

function userTradeDedupKey(trade: UserTradeRow): string {
  if (trade.tradeId != null) return `trade:${String(trade.tradeId)}`;
  return [
    'fill',
    trade.orderId,
    trade.time,
    trade.side,
    trade.price,
    trade.qty,
    trade.realizedPnl,
    trade.commission,
  ].join(':');
}

export async function fetchUserTradesByTimeWindows(
  symbolUsdt: string,
  nowMs: number,
  lookbackMs = USER_TRADES_LOOKBACK_MS
): Promise<UserTradeRow[]> {
  const cutoffExclusive = nowMs - lookbackMs;
  const unique = new Map<string, UserTradeRow>();
  let windowEnd = nowMs;

  while (windowEnd > cutoffExclusive) {
    // Both endpoints are inclusive. Subtract one millisecond so the requested
    // span never exceeds Binance's seven-day maximum, then advance backwards
    // without overlapping the adjacent window.
    const windowStart = Math.max(cutoffExclusive + 1, windowEnd - USER_TRADES_WINDOW_MS + 1);
    const fetchCompleteWindow = async (startTime: number, endTime: number): Promise<void> => {
      const batch = await getUserTrades(symbolUsdt, { limit: 1000, startTime, endTime }) as UserTradeRow[];
      if (batch.length >= 1000) {
        // Subdivision avoids losing fills sharing a timestamp. If one ms is saturated,
        // fail explicitly instead of returning an incomplete accounting result.
        if (startTime >= endTime) throw new Error('userTrades saturated within one millisecond');
        const mid = Math.floor((startTime + endTime) / 2);
        await fetchCompleteWindow(startTime, mid);
        await fetchCompleteWindow(mid + 1, endTime);
        return;
      }
      for (const trade of batch) {
        if (trade.time >= startTime && trade.time <= endTime) unique.set(userTradeDedupKey(trade), trade);
      }
    };
    await fetchCompleteWindow(windowStart, windowEnd);
    windowEnd = windowStart - 1;
  }

  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export function clearBinanceTradeHistoryCacheForTests(): void {
  roundsCache.clear();
}

/** Only completed, flat-to-flat rounds belong in the closed history. */
export function aggregateUserTradesToRounds(trades: UserTradeRow[], symbol: string): BinanceTradeRound[] {
  return reconstructExchangeRounds(trades).filter(r => r.quantity >= DUST_QTY).map(r => ({
    id: `binance_${r.closeTime}_${r.side}`,
    symbol: symbol.toUpperCase().replace(/USDT$/i, ''), side: r.side,
    entryPrice: r.entryPrice, closePrice: r.closePrice, quantity: r.quantity,
    fee: r.entryFee + r.exitFee, realizedPnL: r.grossPnl,
    closeReason: 'binance_fills', status: 'closed' as const,
    closedAt: new Date(r.closeTime).toISOString(), openedAt: new Date(r.entryTime).toISOString(),
  })).reverse();
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
    const net = r.netPnl ?? r.realizedPnL - r.fee - (r.fundingFee ?? 0);
    if (net < -0.01) {
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
  limit = 20,
  options: BinanceTradeHistoryFetchOptions = {}
): Promise<BinanceTradeRound[]> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return [];
  }

  const symbolUsdt = pairSymbol(symbol);
  const nowMs = options.nowMs ?? Date.now();
  const lookbackMs = options.lookbackMs ?? USER_TRADES_LOOKBACK_MS;
  const cacheTtlMs = options.cacheTtlMs ?? USER_TRADES_CACHE_TTL_MS;
  const cacheKey = `${symbolUsdt}:${lookbackMs}`;
  const cached = roundsCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.rounds.slice(0, limit);

  const cutoff = nowMs - lookbackMs;
  const raw = await fetchUserTradesByTimeWindows(symbolUsdt, nowMs, lookbackMs);
  const rounds = aggregateUserTradesToRounds(raw, symbol).filter(
    (r) => new Date(r.closedAt).getTime() >= cutoff
  );

  const income = await fetchBinanceIncomeRows({ symbol, startTime: cutoff, endTime: nowMs });
  for (const r of rounds) {
    r.fundingFee = -income.filter(row => row.incomeType === 'FUNDING_FEE' &&
      row.time >= Date.parse(r.openedAt!) && row.time <= Date.parse(r.closedAt))
      .reduce((sum, row) => sum + Number(row.income), 0);
    r.netPnl = r.realizedPnL - r.fee - r.fundingFee;
  }

  roundsCache.set(cacheKey, {
    expiresAt: nowMs + Math.max(0, cacheTtlMs),
    rounds,
  });
  return rounds.slice(0, limit);
}
