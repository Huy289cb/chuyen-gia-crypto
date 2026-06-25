import { prisma } from '../lib/prisma';
import { getTestnetAccount, getTestnetPendingOrders, getTestnetPositions } from '../repositories/testnet.repository';
import { getDayBoundsICT } from '../utils/ict-time';
import { getRiskPolicy } from '../config/risk-policy';
import { fetchActiveBinancePositions } from './binance-exposure.service';
import { getOpenOrders, getOpenAlgoOrders } from './binance/trading';
import { resolveMarkPrice, calculateUnrealizedPnl } from './position-mark';
import { fetchBinanceIncomeSummary } from './binance-income.service';
import { fetchBinanceClosedTradeRounds } from './binance-trade-history.service';
import { syncTestnetAccountFromBinance } from './binance-balance-sync.service';

/** Max |wallet − Σ position PnL| before DB position stats are hidden in UI. */
export const PNL_DB_GAP_TRUST_USD = 5;

export interface AccountBalanceSummary {
  isInitialized: boolean;
  symbol: string;
  methodId: string;
  totalBalance: number;
  availableBalance: number;
  equity: number;
  usedMargin: number;
  freeMargin: number;
  dailyPnL: number;
  weeklyPnL: number;
  openUnrealized: number;
  exposureUsd: number;
  maxExposureUsd: number;
  /** Wallet − starting_balance (Binance-aligned baseline). */
  walletPnl: number;
  /** account.realized_pnl from Binance income sync. */
  binanceRealizedPnl: number;
  /** Sum of closed position rows (may differ until fill backfill). */
  dbPositionPnlSum: number;
  /** walletPnl − dbPositionPnlSum (0 when aligned). */
  dbPositionPnlGap: number;
  /** True when gap is small enough to show per-position / DB win stats. */
  dbPositionPnlTrusted: boolean;
  /** Primary PnL label for UI: always wallet (Binance-aligned). */
  pnlSource: 'wallet';
  totalFees: number;
  fundingFees: number;
  startingBalance: number;
}

export interface TodayTradeStats {
  closedCount: number;
  wins: number;
  losses: number;
  totalRealizedPnl: number;
  totalFees: number;
  /** False when wallet vs DB closed-PnL gap exceeds trust threshold (DB path only). */
  fromDbPositions: boolean;
  /** Where closed-trade stats were loaded from. */
  source: 'db' | 'binance';
}

export async function getAccountBalanceSummary(
  symbol: string,
  methodId: string,
  useIct = true,
  refreshFromBinance = false
): Promise<AccountBalanceSummary> {
  const empty: AccountBalanceSummary = {
    isInitialized: false,
    symbol,
    methodId,
    totalBalance: 0,
    availableBalance: 0,
    equity: 0,
    usedMargin: 0,
    freeMargin: 0,
    dailyPnL: 0,
    weeklyPnL: 0,
    openUnrealized: 0,
    exposureUsd: 0,
    maxExposureUsd: getRiskPolicy().maxTotalExposureUsd,
    walletPnl: 0,
    binanceRealizedPnl: 0,
    dbPositionPnlSum: 0,
    dbPositionPnlGap: 0,
    dbPositionPnlTrusted: true,
    pnlSource: 'wallet',
    totalFees: 0,
    fundingFees: 0,
    startingBalance: 0,
  };

  const account = await getTestnetAccount(symbol, methodId);
  if (!account) return empty;

  const binanceEnabled = process.env.BINANCE_ENABLED === 'true';
  let liveAccount = account;
  if (binanceEnabled && refreshFromBinance) {
    try {
      await syncTestnetAccountFromBinance(account.id);
      const refreshed = await getTestnetAccount(symbol, methodId);
      if (refreshed) liveAccount = refreshed;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountSummary] Binance balance refresh failed: ${msg}`);
    }
  }

  const dayStart = useIct
    ? getDayBoundsICT().dayStart
    : (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })();
  const weekStart = useIct
    ? getDayBoundsICT().weekStart
    : (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 7);
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })();

  const [baselineDay, baselineWeek, marginAgg, realizedTodayAgg, realizedWeekAgg, unrealizedOpenAgg, dbClosedSum, openPositions, pendingOrders] =
    await Promise.all([
      prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: account.id, timestamp: { lt: dayStart } },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: account.id, timestamp: { lt: weekStart } },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.testnetPosition.aggregate({
        where: { account_id: account.id, status: { in: ['open', 'OPEN'] } },
        _sum: { risk_usd: true },
      }),
      prisma.testnetPosition.aggregate({
        where: {
          account_id: account.id,
          status: { in: ['closed', 'CLOSED'] },
          close_time: { gte: dayStart },
        },
        _sum: { realized_pnl: true },
      }),
      prisma.testnetPosition.aggregate({
        where: {
          account_id: account.id,
          status: { in: ['closed', 'CLOSED'] },
          close_time: { gte: weekStart },
        },
        _sum: { realized_pnl: true },
      }),
      prisma.testnetPosition.aggregate({
        where: { account_id: account.id, status: { in: ['open', 'OPEN'] } },
        _sum: { unrealized_pnl: true },
      }),
      prisma.testnetPosition.aggregate({
        where: {
          account_id: account.id,
          status: { in: ['closed', 'CLOSED'] },
          position_id: { not: 'pipeline_v3_kim_nghia' },
        },
        _sum: { realized_pnl: true },
      }),
      getTestnetPositions({ symbol, status: 'open', methodId }),
      getTestnetPendingOrders({ symbol, status: 'pending', methodId }),
    ]);

  const openUnrealizedDb = unrealizedOpenAgg._sum.unrealized_pnl ?? 0;
  const realizedToday = realizedTodayAgg._sum.realized_pnl ?? 0;
  const realizedWeek = realizedWeekAgg._sum.realized_pnl ?? 0;
  const startDayEquity = baselineDay?.equity ?? liveAccount.equity ?? 0;
  const startWeekEquity = baselineWeek?.equity ?? liveAccount.equity ?? 0;
  const equity = liveAccount.equity ?? liveAccount.current_balance ?? 0;

  let openUnrealized = openUnrealizedDb;
  if (binanceEnabled) {
    try {
      const liveLines = await getBinanceOpenPositionLines(symbol);
      if (liveLines.length > 0) {
        openUnrealized = liveLines.reduce((s, p) => s + p.unrealizedPnl, 0);
      } else {
        openUnrealized = liveAccount.unrealized_pnl ?? 0;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountSummary] Binance open unrealized failed: ${msg}`);
      openUnrealized = liveAccount.unrealized_pnl ?? openUnrealizedDb;
    }
  }

  const dbPositionPnlSum = dbClosedSum._sum.realized_pnl ?? 0;
  const startingBalance = liveAccount.starting_balance || 0;
  const totalBalance = liveAccount.current_balance || 0;
  const walletPnl = totalBalance - startingBalance;
  const dbPositionPnlGap = walletPnl - dbPositionPnlSum;
  const dbPositionPnlTrusted = Math.abs(dbPositionPnlGap) <= PNL_DB_GAP_TRUST_USD;

  let dailyPnL: number;
  let weeklyPnL: number;
  if (binanceEnabled || !dbPositionPnlTrusted) {
    dailyPnL = equity - startDayEquity;
    weeklyPnL = equity - startWeekEquity;
  } else {
    dailyPnL =
      realizedToday !== 0 || openUnrealized !== 0 ? realizedToday + openUnrealized : equity - startDayEquity;
    weeklyPnL =
      realizedWeek !== 0 || openUnrealized !== 0 ? realizedWeek + openUnrealized : equity - startWeekEquity;
  }

  const usedMargin = marginAgg._sum.risk_usd || 0;
  const openVol = openPositions.reduce((s, p) => s + Math.abs(Number(p.size_usd) || 0), 0);
  const pendingVol = pendingOrders.reduce((s, o) => s + Math.abs(Number(o.size_usd) || 0), 0);

  return {
    isInitialized: true,
    symbol,
    methodId,
    totalBalance,
    availableBalance: Math.max(0, totalBalance - usedMargin),
    equity,
    usedMargin,
    freeMargin: Math.max(0, equity - usedMargin),
    dailyPnL,
    weeklyPnL,
    openUnrealized,
    exposureUsd: openVol + pendingVol,
    maxExposureUsd: getRiskPolicy().maxTotalExposureUsd,
    walletPnl,
    binanceRealizedPnl: liveAccount.realized_pnl ?? 0,
    dbPositionPnlSum,
    dbPositionPnlGap,
    dbPositionPnlTrusted,
    pnlSource: 'wallet',
    totalFees: liveAccount.accumulated_trading_fees ?? 0,
    fundingFees: liveAccount.accumulated_funding_fee ?? 0,
    startingBalance,
  };
}

export async function getTodayTradeStatsIct(
  symbol: string,
  methodId: string
): Promise<TodayTradeStats> {
  const account = await getTestnetAccount(symbol, methodId);
  if (!account) {
    return {
      closedCount: 0,
      wins: 0,
      losses: 0,
      totalRealizedPnl: 0,
      totalFees: 0,
      fromDbPositions: false,
      source: 'db',
    };
  }

  const { dayStart } = getDayBoundsICT();

  if (process.env.BINANCE_ENABLED === 'true') {
    try {
      return await getTodayTradeStatsFromBinance(symbol, dayStart);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountSummary] Binance today trade stats failed: ${msg}`);
    }
  }

  const closed = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: { in: ['closed', 'CLOSED'] },
      close_time: { gte: dayStart },
    },
    select: { realized_pnl: true, entry_fee: true, exit_fee: true, funding_fee: true },
  });

  let wins = 0;
  let losses = 0;
  let totalRealizedPnl = 0;
  let totalFees = 0;
  for (const p of closed) {
    const pnl = p.realized_pnl ?? 0;
    totalRealizedPnl += pnl;
    totalFees += (p.entry_fee ?? 0) + (p.exit_fee ?? 0) + (p.funding_fee ?? 0);
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }

  const balance = await getAccountBalanceSummary(symbol, methodId, true);

  return {
    closedCount: closed.length,
    wins,
    losses,
    totalRealizedPnl,
    totalFees,
    fromDbPositions: balance.dbPositionPnlTrusted,
    source: 'db',
  };
}

async function getTodayTradeStatsFromBinance(
  symbol: string,
  dayStart: Date
): Promise<TodayTradeStats> {
  const [income, rounds] = await Promise.all([
    fetchBinanceIncomeSummary({ startTime: dayStart.getTime(), symbol }),
    fetchBinanceClosedTradeRounds(symbol, 100),
  ]);

  const todayRounds = rounds.filter((r) => new Date(r.closedAt) >= dayStart);
  let wins = 0;
  let losses = 0;
  for (const r of todayRounds) {
    if (r.realizedPnL > 0) wins++;
    else if (r.realizedPnL < 0) losses++;
  }

  return {
    closedCount: todayRounds.length,
    wins,
    losses,
    totalRealizedPnl: income.netTradingPnl,
    totalFees: Math.abs(income.commission),
    fromDbPositions: false,
    source: 'binance',
  };
}

export interface OpenPositionLine {
  positionId: string;
  symbol: string;
  side: string;
  entry: number;
  mark: number;
  unrealizedPnl: number;
  sizeUsd: number;
  sizeQty: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

export interface PendingOrderLine {
  orderId: string;
  symbol: string;
  side: string;
  entry: number;
  status: string;
}

export async function getOpenPositionLines(
  symbol?: string,
  methodId = 'kim_nghia'
): Promise<OpenPositionLine[]> {
  const positions = await getTestnetPositions({
    symbol,
    status: 'open',
    methodId,
  });

  const lines: OpenPositionLine[] = [];
  for (const pos of positions) {
    const entry = pos.entry_price || 0;
    const mark = await resolveMarkPrice(pos.symbol, pos.current_price || entry);
    const uPnL = calculateUnrealizedPnl(pos.side, entry, mark, pos.size_qty || 0);
    lines.push({
      positionId: pos.position_id,
      symbol: pos.symbol,
      side: pos.side,
      entry,
      mark,
      unrealizedPnl: uPnL,
      sizeUsd: pos.size_usd || 0,
      sizeQty: Math.abs(pos.size_qty || 0),
    });
  }
  return lines;
}

function pairUsdt(symbol: string): string {
  return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}

/** Open positions from Binance positionRisk (source of truth). */
export async function getBinanceOpenPositionLines(symbol?: string): Promise<OpenPositionLine[]> {
  const active = await fetchActiveBinancePositions(symbol, { allowUserTradesFallback: false });
  return active.map((p) => {
    const mark = p.markPrice || p.entryPrice;
    const unrealizedPnl =
      p.unRealizedProfit ??
      calculateUnrealizedPnl(p.side, p.entryPrice, mark, p.positionAmt);
    const sizeUsd =
      p.notional != null && Math.abs(p.notional) > 0
        ? Math.abs(p.notional)
        : p.positionAmt * mark;
    return {
      positionId: `binance-${p.symbol}-${p.side}`,
      symbol: p.symbol,
      side: p.side,
      entry: p.entryPrice,
      mark,
      unrealizedPnl,
      sizeUsd,
      sizeQty: p.positionAmt,
    };
  });
}

/** Pending limit orders from Binance openOrders. */
export async function getBinancePendingOrderLines(symbol?: string): Promise<PendingOrderLine[]> {
  const orders = await getOpenOrders(symbol ? pairUsdt(symbol) : null);
  return orders
    .filter((o) => {
      const t = String(o.type ?? '').toUpperCase();
      const st = String(o.status ?? '').toUpperCase();
      return t === 'LIMIT' && (st === 'NEW' || st === 'PARTIALLY_FILLED');
    })
    .map((o) => ({
      orderId: String(o.orderId),
      symbol: String(o.symbol ?? '').replace(/USDT$/i, ''),
      side: String(o.side).toUpperCase() === 'BUY' ? 'long' : 'short',
      entry: Number(o.price) || 0,
      status: String(o.status ?? 'NEW'),
    }));
}

/** Prefer Binance live data when BINANCE_ENABLED. */
export async function getLiveOpenPositionLines(
  symbol?: string,
  methodId = 'kim_nghia'
): Promise<OpenPositionLine[]> {
  const scopeSymbol = symbol ?? getDefaultTradingScope().symbol;
  if (process.env.BINANCE_ENABLED === 'true') {
    try {
      const lines = await getBinanceOpenPositionLines(symbol);
      return enrichPositionsWithBinanceSlTp(lines, scopeSymbol);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountSummary] Binance open positions failed: ${msg}`);
    }
  }
  return getOpenPositionLines(symbol, methodId);
}

export async function getLivePendingOrderLines(
  symbol?: string,
  methodId = 'kim_nghia'
): Promise<PendingOrderLine[]> {
  if (process.env.BINANCE_ENABLED === 'true') {
    try {
      return await getBinancePendingOrderLines(symbol);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountSummary] Binance pending orders failed: ${msg}`);
    }
  }
  return getPendingOrderLines(symbol, methodId);
}

function algoTriggerPrice(order: {
  triggerPrice?: number | null;
  stopPrice?: number | null;
  price?: number | null;
}): number {
  return Number(order.triggerPrice ?? order.stopPrice ?? order.price ?? 0) || 0;
}

/** Attach SL/TP from Binance open algo orders (same source as sàn). */
export async function enrichPositionsWithBinanceSlTp(
  positions: OpenPositionLine[],
  symbol = 'BTC'
): Promise<OpenPositionLine[]> {
  if (positions.length === 0) return positions;

  try {
    const algos = await getOpenAlgoOrders(pairUsdt(symbol));
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;

    for (const order of algos) {
      const t = String(order.orderType ?? order.type ?? '').toUpperCase();
      if (!t.includes('STOP') && !t.includes('TAKE_PROFIT')) continue;
      const px = algoTriggerPrice(order);
      if (px <= 0) continue;
      if (t.includes('TAKE_PROFIT')) takeProfit = px;
      else if (t.includes('STOP')) stopLoss = px;
    }

    return positions.map((p) => ({ ...p, stopLoss, takeProfit }));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[AccountSummary] Binance SL/TP fetch failed: ${msg}`);
    return positions;
  }
}

export async function getPendingOrderLines(
  symbol?: string,
  methodId = 'kim_nghia'
): Promise<PendingOrderLine[]> {
  const orders = await getTestnetPendingOrders({
    symbol,
    status: 'pending',
    methodId,
  });
  return orders.map((o) => ({
    orderId: o.order_id,
    symbol: o.symbol,
    side: o.side,
    entry: o.entry_price || 0,
    status: o.status,
  }));
}

export function getDefaultTradingScope(): { symbol: string; methodId: string } {
  const symbols = (process.env.ENABLED_SYMBOLS || 'BTC').split(',')[0]?.trim() || 'BTC';
  return { symbol: symbols.toUpperCase(), methodId: 'kim_nghia' };
}
