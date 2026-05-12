/**
 * Trade Repository
 * Handles database operations for trade-related data
 * This is a placeholder for future trade-specific operations
 * that may be separate from the memory system
 */

import { prisma } from '../lib/prisma';

/**
 * Get trade decision by ID
 */
export async function getTradeDecisionById(id: number) {
  return await prisma.tradeDecision.findUnique({
    where: { id },
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
 * Get trade outcome by decision ID
 */
export async function getTradeOutcomeByDecisionId(decisionId: number) {
  return await prisma.tradeOutcome.findUnique({
    where: { decision_id: decisionId },
    include: {
      decision: true,
      reflection: true
    }
  });
}

/**
 * Get all trade decisions for a method
 */
export async function getTradeDecisionsByMethod(methodId: string, limit: number = 50) {
  return await prisma.tradeDecision.findMany({
    where: { method_id: methodId },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      trade_outcome: true
    }
  });
}

/**
 * Get trade decisions filtered by grade
 */
export async function getTradeDecisionsByGrade(grade: string, limit: number = 50) {
  return await prisma.tradeDecision.findMany({
    where: { grade },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      trade_outcome: true
    }
  });
}

/**
 * Get no-trade decisions
 */
export async function getNoTradeDecisions(symbol: string, limit: number = 20) {
  return await prisma.tradeDecision.findMany({
    where: {
      symbol,
      decision: 'no_trade'
    },
    orderBy: { timestamp: 'desc' },
    take: limit
  });
}

/**
 * Get trade decisions within a date range
 */
export async function getTradeDecisionsByDateRange(
  symbol: string,
  startDate: Date,
  endDate: Date
) {
  return await prisma.tradeDecision.findMany({
    where: {
      symbol,
      timestamp: {
        gte: startDate,
        lte: endDate
      }
    },
    orderBy: { timestamp: 'desc' },
    include: {
      trade_outcome: {
        include: {
          reflection: true
        }
      }
    }
  });
}
