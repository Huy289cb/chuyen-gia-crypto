import { prisma } from '../lib/prisma';
import { getTestnetAccount, getTestnetPendingOrders, getTestnetPositions } from '../repositories/testnet.repository';
import { getDayBoundsICT } from '../utils/ict-time';
import { getRiskPolicy } from '../config/risk-policy';
import { resolveMarkPrice, calculateUnrealizedPnl } from './position-mark';

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
  /** False when wallet vs DB closed-PnL gap exceeds trust threshold. */
  fromDbPositions: boolean;
}

export async function getAccountBalanceSummary(
  symbol: string,
  methodId: string,
  useIct = true
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

  const openUnrealized = unrealizedOpenAgg._sum.unrealized_pnl ?? 0;
  const realizedToday = realizedTodayAgg._sum.realized_pnl ?? 0;
  const realizedWeek = realizedWeekAgg._sum.realized_pnl ?? 0;
  const startDayEquity = baselineDay?.equity ?? account.equity ?? 0;
  const startWeekEquity = baselineWeek?.equity ?? account.equity ?? 0;
  const equity = account.equity ?? account.current_balance ?? 0;

  const dailyPnL =
    realizedToday !== 0 || openUnrealized !== 0 ? realizedToday + openUnrealized : equity - startDayEquity;
  const weeklyPnL =
    realizedWeek !== 0 || openUnrealized !== 0 ? realizedWeek + openUnrealized : equity - startWeekEquity;

  const usedMargin = marginAgg._sum.risk_usd || 0;
  const openVol = openPositions.reduce((s, p) => s + Math.abs(Number(p.size_usd) || 0), 0);
  const pendingVol = pendingOrders.reduce((s, o) => s + Math.abs(Number(o.size_usd) || 0), 0);
  const startingBalance = account.starting_balance || 0;
  const totalBalance = account.current_balance || 0;
  const walletPnl = totalBalance - startingBalance;
  const dbPositionPnlSum = dbClosedSum._sum.realized_pnl ?? 0;
  const dbPositionPnlGap = walletPnl - dbPositionPnlSum;
  const dbPositionPnlTrusted = Math.abs(dbPositionPnlGap) <= PNL_DB_GAP_TRUST_USD;

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
    binanceRealizedPnl: account.realized_pnl ?? 0,
    dbPositionPnlSum,
    dbPositionPnlGap,
    dbPositionPnlTrusted,
    pnlSource: 'wallet',
    totalFees: account.accumulated_trading_fees ?? 0,
    fundingFees: account.accumulated_funding_fee ?? 0,
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
    };
  }

  const { dayStart } = getDayBoundsICT();
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
    });
  }
  return lines;
}

export interface PendingOrderLine {
  orderId: string;
  symbol: string;
  side: string;
  entry: number;
  status: string;
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
