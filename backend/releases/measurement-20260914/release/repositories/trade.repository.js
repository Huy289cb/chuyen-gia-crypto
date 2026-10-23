"use strict";
/**
 * Trade Repository
 * Handles database operations for trade-related data
 * This is a placeholder for future trade-specific operations
 * that may be separate from the memory system
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTradeDecisionById = getTradeDecisionById;
exports.getTradeOutcomeByDecisionId = getTradeOutcomeByDecisionId;
exports.getTradeDecisionsByMethod = getTradeDecisionsByMethod;
exports.getTradeDecisionsByGrade = getTradeDecisionsByGrade;
exports.getNoTradeDecisions = getNoTradeDecisions;
exports.getTradeDecisionsByDateRange = getTradeDecisionsByDateRange;
const prisma_1 = require("../lib/prisma");
/**
 * Get trade decision by ID
 */
async function getTradeDecisionById(id) {
    return await prisma_1.prisma.tradeDecision.findUnique({
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
async function getTradeOutcomeByDecisionId(decisionId) {
    return await prisma_1.prisma.tradeOutcome.findUnique({
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
async function getTradeDecisionsByMethod(methodId, limit = 50) {
    return await prisma_1.prisma.tradeDecision.findMany({
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
async function getTradeDecisionsByGrade(grade, limit = 50) {
    return await prisma_1.prisma.tradeDecision.findMany({
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
async function getNoTradeDecisions(symbol, limit = 20) {
    return await prisma_1.prisma.tradeDecision.findMany({
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
async function getTradeDecisionsByDateRange(symbol, startDate, endDate) {
    return await prisma_1.prisma.tradeDecision.findMany({
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
//# sourceMappingURL=trade.repository.js.map