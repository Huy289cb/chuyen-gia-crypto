/**
 * Memory Repository
 * Handles database operations for trade decisions, outcomes, reflections, and playbook stats
 */

import { prisma } from '../lib/prisma';

export interface TradeDecisionInput {
  symbol: string;
  timeframe: string;
  playbook_key: string;
  grade: string;
  confidence: number;
  regime: string;
  decision: string;
  reason: string;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  expected_rr?: number;
  candle_hash?: string;
  method_id?: string;
}

export interface TradeOutcomeInput {
  decision_id: number;
  symbol: string;
  outcome: string;
  entry_price: number;
  exit_price: number;
  realized_pnl: number;
  realized_rr: number;
  execution_cost?: number;
  duration_minutes?: number;
  close_reason: string;
}

export interface TradeReflectionInput {
  outcome_id: number;
  symbol: string;
  what_went_wrong?: string;
  what_worked?: string;
  lesson_learned?: string;
}

export interface PlaybookStatsInput {
  playbook_key: string;
  symbol: string;
}

/**
 * Store a trade decision
 */
export async function storeTradeDecision(input: TradeDecisionInput) {
  return await prisma.tradeDecision.create({
    data: input
  });
}

/**
 * Store a trade outcome
 */
export async function storeTradeOutcome(input: TradeOutcomeInput) {
  return await prisma.tradeOutcome.create({
    data: input
  });
}

/**
 * Store a trade reflection
 */
export async function storeTradeReflection(input: TradeReflectionInput) {
  return await prisma.tradeReflection.create({
    data: input
  });
}

/**
 * Get recent trade decisions for a symbol
 */
export async function getRecentTradeDecisions(symbol: string, limit: number = 10) {
  return await prisma.tradeDecision.findMany({
    where: { symbol },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      trade_outcome: {
        include: {
          reflection: true
        }
      }
    }
  });
}

/**
 * Get similar trades by playbook and regime
 */
export async function getSimilarTrades(
  playbook_key: string,
  regime: string,
  symbol: string,
  limit: number = 5
) {
  return await prisma.tradeDecision.findMany({
    where: {
      playbook_key,
      regime,
      symbol
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      trade_outcome: true
    }
  });
}

/**
 * Get recent failures (losses) for a symbol
 */
export async function getRecentFailures(symbol: string, limit: number = 3) {
  return await prisma.tradeOutcome.findMany({
    where: {
      symbol,
      outcome: 'loss'
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      decision: true,
      reflection: true
    }
  });
}

/**
 * Get or create playbook stats
 */
export async function getPlaybookStats(playbook_key: string, symbol: string) {
  let stats = await prisma.playbookStats.findUnique({
    where: {
      playbook_key
    }
  });

  if (!stats) {
    stats = await prisma.playbookStats.create({
      data: {
        playbook_key,
        symbol
      }
    });
  }

  return stats;
}

/**
 * Update playbook stats after a trade
 */
export async function updatePlaybookStats(
  playbook_key: string,
  symbol: string,
  outcome: string,
  pnl: number,
  rr: number
) {
  const stats = await getPlaybookStats(playbook_key, symbol);

  const totalTrades = stats.total_trades + 1;
  const winningTrades = outcome === 'win' ? stats.winning_trades + 1 : stats.winning_trades;
  const losingTrades = outcome === 'loss' ? stats.losing_trades + 1 : stats.losing_trades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const avgRr = (stats.avg_rr * stats.total_trades + rr) / totalTrades;
  const avgPnl = (stats.avg_pnl * stats.total_trades + pnl) / totalTrades;
  const totalPnl = stats.total_pnl + pnl;

  return await prisma.playbookStats.update({
    where: {
      playbook_key
    },
    data: {
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: winRate,
      avg_rr: avgRr,
      avg_pnl: avgPnl,
      total_pnl: totalPnl,
      last_updated: new Date()
    }
  });
}

/**
 * Get all playbook stats for a symbol
 */
export async function getAllPlaybookStats(symbol: string) {
  return await prisma.playbookStats.findMany({
    where: { symbol },
    orderBy: { total_trades: 'desc' }
  });
}
