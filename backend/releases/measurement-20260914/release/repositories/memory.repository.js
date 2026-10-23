"use strict";
/**
 * Memory Repository
 * Handles database operations for trade decisions, outcomes, reflections, and playbook stats
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findTradeDecisionForBar = findTradeDecisionForBar;
exports.storeTradeDecision = storeTradeDecision;
exports.updateTradeDecisionReason = updateTradeDecisionReason;
exports.storeTradeOutcome = storeTradeOutcome;
exports.storeTradeReflection = storeTradeReflection;
exports.getRecentTradeDecisions = getRecentTradeDecisions;
exports.getSimilarTrades = getSimilarTrades;
exports.getRecentFailures = getRecentFailures;
exports.getRecentOutcomesWithReflection = getRecentOutcomesWithReflection;
exports.getPlaybookStats = getPlaybookStats;
exports.updatePlaybookStats = updatePlaybookStats;
exports.getAllPlaybookStats = getAllPlaybookStats;
const prisma_1 = require("../lib/prisma");
/**
 * Store a trade decision
 */
async function findTradeDecisionForBar(symbol, timeframe, candle_hash, method_id) {
    return await prisma_1.prisma.tradeDecision.findFirst({
        where: { symbol, timeframe, candle_hash, method_id },
        orderBy: { timestamp: 'desc' },
    });
}
async function storeTradeDecision(input) {
    return await prisma_1.prisma.tradeDecision.create({
        data: input
    });
}
async function updateTradeDecisionReason(id, reason) {
    return await prisma_1.prisma.tradeDecision.update({
        where: { id },
        data: { reason },
    });
}
/**
 * Store a trade outcome
 */
async function storeTradeOutcome(input) {
    return await prisma_1.prisma.tradeOutcome.create({
        data: input
    });
}
/**
 * Store a trade reflection
 */
async function storeTradeReflection(input) {
    return await prisma_1.prisma.tradeReflection.create({
        data: input
    });
}
/**
 * Get recent trade decisions for a symbol
 */
async function getRecentTradeDecisions(symbol, limit = 10) {
    return await prisma_1.prisma.tradeDecision.findMany({
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
async function getSimilarTrades(playbook_key, regime, symbol, limit = 5) {
    return await prisma_1.prisma.tradeDecision.findMany({
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
async function getRecentFailures(symbol, limit = 3) {
    return await prisma_1.prisma.tradeOutcome.findMany({
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
/** Closed trades with reflections for LLM learning (same symbol). */
async function getRecentOutcomesWithReflection(symbol, limit = 5) {
    return await prisma_1.prisma.tradeOutcome.findMany({
        where: { symbol },
        orderBy: { timestamp: 'desc' },
        take: limit,
        include: {
            reflection: true,
            decision: { select: { timeframe: true, playbook_key: true, regime: true, reason: true } },
        },
    });
}
/**
 * Get or create playbook stats
 */
async function getPlaybookStats(playbook_key, symbol) {
    let stats = await prisma_1.prisma.playbookStats.findUnique({
        where: {
            playbook_key
        }
    });
    if (!stats) {
        stats = await prisma_1.prisma.playbookStats.create({
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
async function updatePlaybookStats(playbook_key, symbol, outcome, pnl, rr) {
    const stats = await getPlaybookStats(playbook_key, symbol);
    const totalTrades = stats.total_trades + 1;
    const winningTrades = outcome === 'win' ? stats.winning_trades + 1 : stats.winning_trades;
    const losingTrades = outcome === 'loss' ? stats.losing_trades + 1 : stats.losing_trades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgRr = (stats.avg_rr * stats.total_trades + rr) / totalTrades;
    const avgPnl = (stats.avg_pnl * stats.total_trades + pnl) / totalTrades;
    const totalPnl = stats.total_pnl + pnl;
    return await prisma_1.prisma.playbookStats.update({
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
async function getAllPlaybookStats(symbol) {
    return await prisma_1.prisma.playbookStats.findMany({
        where: { symbol },
        orderBy: { total_trades: 'desc' }
    });
}
//# sourceMappingURL=memory.repository.js.map