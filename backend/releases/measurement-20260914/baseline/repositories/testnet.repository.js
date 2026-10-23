"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKING_PENDING_ORDER_STATUSES = exports.PIPELINE_EVENT_POSITION_ID = exports.ACTIVE_TESTNET_POSITION_STATUSES = void 0;
exports.getOrCreateTestnetAccount = getOrCreateTestnetAccount;
exports.getTestnetAccount = getTestnetAccount;
exports.updateTestnetAccountBalance = updateTestnetAccountBalance;
exports.updateTestnetAccountEquityDirect = updateTestnetAccountEquityDirect;
exports.updateTradingFees = updateTradingFees;
exports.updateFundingFee = updateFundingFee;
exports.updateTestnetAccountEquity = updateTestnetAccountEquity;
exports.updateTestnetAccountStats = updateTestnetAccountStats;
exports.shouldEnterTestnetCooldown = shouldEnterTestnetCooldown;
exports.setTestnetAccountCooldown = setTestnetAccountCooldown;
exports.createTestnetPosition = createTestnetPosition;
exports.getActiveTestnetPositions = getActiveTestnetPositions;
exports.findTestnetPositionByBinanceOrderId = findTestnetPositionByBinanceOrderId;
exports.getTestnetPositions = getTestnetPositions;
exports.getTestnetPosition = getTestnetPosition;
exports.updateTestnetPosition = updateTestnetPosition;
exports.closeTestnetPosition = closeTestnetPosition;
exports.ensurePipelineEventPosition = ensurePipelineEventPosition;
exports.recordPipelineEvent = recordPipelineEvent;
exports.recordSilentPipelineEvent = recordSilentPipelineEvent;
exports.hasSilentPipelineEventKey = hasSilentPipelineEventKey;
exports.getSilentPipelineEvents = getSilentPipelineEvents;
exports.recordTestnetTradeEvent = recordTestnetTradeEvent;
exports.getTestnetTradeEvents = getTestnetTradeEvents;
exports.createTestnetAccountSnapshot = createTestnetAccountSnapshot;
exports.getTestnetAccountSnapshots = getTestnetAccountSnapshots;
exports.getTestnetPerformanceMetrics = getTestnetPerformanceMetrics;
exports.resetTestnetAccount = resetTestnetAccount;
exports.getTestnetPendingOrders = getTestnetPendingOrders;
exports.getBlockingTestnetPendingOrders = getBlockingTestnetPendingOrders;
exports.getTestnetPendingOrderByBinanceId = getTestnetPendingOrderByBinanceId;
exports.getTestnetPendingOrderByOrderId = getTestnetPendingOrderByOrderId;
exports.executeTestnetPendingOrder = executeTestnetPendingOrder;
exports.cancelTestnetPendingOrder = cancelTestnetPendingOrder;
exports.updateTestnetPendingOrder = updateTestnetPendingOrder;
exports.createTestnetPendingOrder = createTestnetPendingOrder;
exports.updatePrecisionError = updatePrecisionError;
exports.resetPrecisionErrorTracking = resetPrecisionErrorTracking;
const prisma_1 = require("../lib/prisma");
const risk_policy_1 = require("../config/risk-policy");
const account_performance_service_1 = require("../services/account-performance.service");
/**
 * Get or create testnet account
 */
async function getOrCreateTestnetAccount(symbol, methodId, startingBalance = 100) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: {
            symbol_method_id: {
                symbol: symbol.toUpperCase(),
                method_id: methodId,
            },
        },
    });
    if (account) {
        return account;
    }
    // If BINANCE_ENABLED is true, fetch actual balance from Binance
    let actualBalance = startingBalance;
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            const { getAccountBalance } = await Promise.resolve().then(() => __importStar(require('../services/binanceClient')));
            const client = {}; // Binance client is not needed for module functions
            const balanceInfo = await getAccountBalance(client);
            if (balanceInfo && balanceInfo.totalWalletBalance) {
                actualBalance = parseFloat(balanceInfo.totalWalletBalance);
                console.log(`[TestnetRepository] Fetched actual balance from Binance: ${actualBalance} USDT for ${symbol}/${methodId}`);
            }
        }
        catch (error) {
            console.warn(`[TestnetRepository] Failed to fetch balance from Binance, using default ${startingBalance}:`, error.message);
        }
    }
    return prisma_1.prisma.testnetAccount.create({
        data: {
            symbol: symbol.toUpperCase(),
            method_id: methodId,
            starting_balance: actualBalance,
            current_balance: actualBalance,
            equity: actualBalance,
        },
    });
}
/**
 * Get testnet account
 */
async function getTestnetAccount(symbol, methodId) {
    return prisma_1.prisma.testnetAccount.findUnique({
        where: {
            symbol_method_id: {
                symbol: symbol.toUpperCase(),
                method_id: methodId,
            },
        },
    });
}
/**
 * Update testnet account balance
 */
async function updateTestnetAccountBalance(accountId, newBalance, pnl = 0) {
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            current_balance: newBalance,
            equity: newBalance,
            realized_pnl: { increment: pnl },
            updated_at: new Date(),
        },
    });
}
/**
 * Update testnet account equity directly
 */
async function updateTestnetAccountEquityDirect(accountId, totalWalletBalance) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account)
        throw new Error('Account not found');
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            equity: totalWalletBalance,
            unrealized_pnl: totalWalletBalance - account.current_balance,
            updated_at: new Date(),
        },
    });
}
/**
 * Update trading fees
 */
async function updateTradingFees(accountId, feeAmount) {
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            accumulated_trading_fees: { increment: feeAmount },
            updated_at: new Date(),
        },
    });
}
/**
 * Update funding fee
 */
async function updateFundingFee(positionId, feeAmount, accountId) {
    await prisma_1.prisma.testnetPosition.update({
        where: { position_id: positionId },
        data: {
            funding_fee: { increment: feeAmount },
        },
    });
    if (accountId) {
        await prisma_1.prisma.testnetAccount.update({
            where: { id: accountId },
            data: {
                accumulated_funding_fee: { increment: feeAmount },
                updated_at: new Date(),
            },
        });
    }
}
/**
 * Update testnet account equity
 */
async function updateTestnetAccountEquity(accountId, unrealizedPnl) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account)
        throw new Error('Account not found');
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            unrealized_pnl: unrealizedPnl,
            equity: account.current_balance + unrealizedPnl,
            updated_at: new Date(),
        },
    });
}
/**
 * Update testnet account stats
 */
async function updateTestnetAccountStats(accountId, isWin) {
    const now = new Date();
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            total_trades: { increment: 1 },
            winning_trades: { increment: isWin ? 1 : 0 },
            losing_trades: { increment: isWin ? 0 : 1 },
            consecutive_losses: isWin ? 0 : { increment: 1 },
            last_trade_time: now,
            updated_at: now,
        },
    });
}
/**
 * Check if should enter cooldown
 */
async function shouldEnterTestnetCooldown(accountId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { id: accountId },
    });
    if (!account) {
        return { shouldCooldown: false, reason: 'Account not found' };
    }
    const consecutiveLosses = account.consecutive_losses || 0;
    const policy = (0, risk_policy_1.getRiskPolicy)();
    if (consecutiveLosses >= policy.lossCooldownTier2MinStreak) {
        const cooldownUntil = (0, risk_policy_1.resolveLossCooldownUntil)(consecutiveLosses, new Date());
        return {
            shouldCooldown: true,
            cooldownUntil: cooldownUntil?.toISOString(),
            consecutiveLosses,
            reason: `${consecutiveLosses} consecutive losses, tiered cooldown until ${cooldownUntil?.toISOString()}`,
        };
    }
    return {
        shouldCooldown: false,
        consecutiveLosses,
        reason: `${consecutiveLosses} consecutive losses, below tier2 threshold ${policy.lossCooldownTier2MinStreak}`,
    };
}
/**
 * Set cooldown timestamp
 */
async function setTestnetAccountCooldown(accountId, cooldownUntil) {
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            cooldown_until: cooldownUntil,
        },
    });
}
/**
 * Create testnet position
 */
async function createTestnetPosition(data) {
    return prisma_1.prisma.testnetPosition.create({
        data: {
            position_id: data.positionId,
            account_id: data.accountId,
            symbol: data.symbol.toUpperCase(),
            side: data.side,
            entry_price: data.entryPrice,
            stop_loss: data.stopLoss,
            take_profit: data.takeProfit,
            size_usd: data.sizeUsd,
            size_qty: data.sizeQty,
            risk_usd: data.riskUsd,
            risk_percent: data.riskPercent,
            expected_rr: data.expectedRr,
            linked_prediction_id: data.linkedPredictionId,
            binance_order_id: data.binanceOrderId,
            binance_sl_order_id: data.binanceSlOrderId,
            binance_tp_order_id: data.binanceTpOrderId,
            tp_levels: data.tpLevels,
            tp_hit_count: data.tpHitCount || 0,
            partial_closed: data.partialClosed || 0,
            entry_fee: data.entryFee || 0,
        },
    });
}
/** Statuses that still block new entries (open or wrongly reconciled). */
exports.ACTIVE_TESTNET_POSITION_STATUSES = [
    'open',
    'reconciliation_failed_not_on_binance',
];
/**
 * Open or recoverable positions (blocks stacking).
 */
async function getActiveTestnetPositions(filters) {
    const where = {
        status: { in: [...exports.ACTIVE_TESTNET_POSITION_STATUSES] },
    };
    if (filters.accountId)
        where.account_id = filters.accountId;
    if (filters.symbol)
        where.symbol = filters.symbol.toUpperCase();
    if (filters.positionId)
        where.position_id = filters.positionId;
    if (filters.methodId)
        where.account = { method_id: filters.methodId };
    return prisma_1.prisma.testnetPosition.findMany({
        where,
        orderBy: { entry_time: 'desc' },
        take: filters.limit,
    });
}
async function findTestnetPositionByBinanceOrderId(binanceOrderId) {
    return prisma_1.prisma.testnetPosition.findFirst({
        where: { binance_order_id: binanceOrderId },
        select: { position_id: true },
    });
}
/**
 * Get testnet positions
 */
async function getTestnetPositions(filters) {
    const where = {};
    if (filters.accountId)
        where.account_id = filters.accountId;
    if (filters.symbol)
        where.symbol = filters.symbol.toUpperCase();
    if (filters.status)
        where.status = filters.status;
    if (filters.positionId)
        where.position_id = filters.positionId;
    if (filters.methodId)
        where.account = { method_id: filters.methodId };
    return prisma_1.prisma.testnetPosition.findMany({
        where,
        orderBy: { entry_time: 'desc' },
        take: filters.limit,
    });
}
/**
 * Get testnet position by ID
 */
async function getTestnetPosition(positionId) {
    return prisma_1.prisma.testnetPosition.findUnique({
        where: { position_id: positionId },
    });
}
/**
 * Update testnet position
 */
async function updateTestnetPosition(positionId, updates) {
    await prisma_1.prisma.testnetPosition.update({
        where: { position_id: positionId },
        data: updates,
    });
}
/**
 * Close testnet position
 */
async function closeTestnetPosition(positionId, closePrice, closeReason) {
    await prisma_1.prisma.testnetPosition.update({
        where: { position_id: positionId },
        data: {
            status: 'closed',
            close_price: closePrice,
            close_time: new Date(),
            close_reason: closeReason,
        },
    });
}
/** Synthetic position for pipeline events (FK target for testnet_trade_events). */
exports.PIPELINE_EVENT_POSITION_ID = 'pipeline_v3_kim_nghia';
/**
 * Ensure a closed placeholder position exists so pipeline events can use the FK.
 */
async function ensurePipelineEventPosition(accountId) {
    const existing = await prisma_1.prisma.testnetPosition.findUnique({
        where: { position_id: exports.PIPELINE_EVENT_POSITION_ID },
    });
    if (existing)
        return exports.PIPELINE_EVENT_POSITION_ID;
    await prisma_1.prisma.testnetPosition.create({
        data: {
            position_id: exports.PIPELINE_EVENT_POSITION_ID,
            account_id: accountId,
            symbol: 'BTC',
            side: 'NONE',
            entry_price: 0,
            stop_loss: 0,
            take_profit: 0,
            size_usd: 0,
            size_qty: 0,
            risk_usd: 0,
            risk_percent: 0,
            expected_rr: 0,
            status: 'closed',
            close_reason: 'pipeline_event_anchor',
        },
    });
    return exports.PIPELINE_EVENT_POSITION_ID;
}
/**
 * Pipeline / LLM events without a real open position (execution_blocked, risk pre-check).
 */
async function recordPipelineEvent(eventType, eventData) {
    try {
        const account = await getOrCreateTestnetAccount('BTC', 'kim_nghia', 10000);
        const positionId = await ensurePipelineEventPosition(account.id);
        return await recordTestnetTradeEvent(positionId, eventType, eventData);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PipelineEvent] Failed to record ${eventType}: ${msg}`);
        return null;
    }
}
/** Persist high-volume observability events without Telegram side effects. */
async function recordSilentPipelineEvent(eventType, eventData) {
    try {
        const account = await getOrCreateTestnetAccount('BTC', 'kim_nghia', 10000);
        const positionId = await ensurePipelineEventPosition(account.id);
        const event = await prisma_1.prisma.testnetTradeEvent.create({
            data: {
                position_id: positionId,
                event_type: eventType,
                event_data: eventData ? JSON.stringify(eventData) : null,
                timestamp: new Date(),
            },
        });
        return event.id;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PipelineEvent] Failed to record silent ${eventType}: ${msg}`);
        return null;
    }
}
/** Restart-safe dedup for JSON observations keyed by a stable bar/candidate key. */
async function hasSilentPipelineEventKey(eventType, jsonField, key) {
    const needle = `\"${jsonField}\":${JSON.stringify(key)}`;
    const row = await prisma_1.prisma.testnetTradeEvent.findFirst({
        where: {
            position_id: exports.PIPELINE_EVENT_POSITION_ID,
            event_type: eventType,
            event_data: { contains: needle },
        },
        select: { id: true },
    });
    return row != null;
}
async function getSilentPipelineEvents(eventTypes, since) {
    const rows = await prisma_1.prisma.testnetTradeEvent.findMany({
        where: {
            position_id: exports.PIPELINE_EVENT_POSITION_ID,
            event_type: { in: eventTypes },
            timestamp: { gte: since },
        },
        orderBy: { timestamp: 'asc' },
        take: 10_000,
        select: { id: true, event_type: true, event_data: true, timestamp: true },
    });
    return rows.flatMap((row) => {
        try {
            return [{
                    id: row.id,
                    event_type: row.event_type,
                    event_data: JSON.parse(row.event_data || '{}'),
                    timestamp: row.timestamp,
                }];
        }
        catch {
            return [];
        }
    });
}
/**
 * Record testnet trade event (requires valid testnet_positions.position_id).
 */
async function recordTestnetTradeEvent(positionId, eventType, eventData) {
    const event = await prisma_1.prisma.testnetTradeEvent.create({
        data: {
            position_id: positionId,
            event_type: eventType,
            event_data: eventData ? JSON.stringify(eventData) : null,
            timestamp: new Date(),
        },
    });
    try {
        const { notifyFromTradeEvent } = await Promise.resolve().then(() => __importStar(require('../services/telegram/telegram-notify.service')));
        notifyFromTradeEvent(eventType, eventData ?? null, positionId);
    }
    catch {
        // Telegram optional — never block trade path
    }
    return event.id;
}
/**
 * Get testnet trade events
 */
async function getTestnetTradeEvents(positionId) {
    const events = await prisma_1.prisma.testnetTradeEvent.findMany({
        where: { position_id: positionId },
        orderBy: { timestamp: 'asc' },
    });
    return events.map((event) => ({
        ...event,
        event_data: event.event_data ? JSON.parse(event.event_data) : null,
    }));
}
/**
 * Create testnet account snapshot
 */
async function createTestnetAccountSnapshot(accountId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { id: accountId },
    });
    if (!account)
        throw new Error('Account not found');
    const openPositions = await prisma_1.prisma.testnetPosition.count({
        where: { account_id: accountId, status: 'open' },
    });
    const snapshot = await prisma_1.prisma.testnetAccountSnapshot.create({
        data: {
            account_id: accountId,
            balance: account.current_balance,
            equity: account.equity,
            unrealized_pnl: account.unrealized_pnl,
            realized_pnl: account.realized_pnl,
            open_positions_count: openPositions,
            timestamp: new Date(),
        },
    });
    return snapshot.id;
}
/**
 * Get testnet account snapshots
 */
async function getTestnetAccountSnapshots(accountId, limit = 100) {
    return prisma_1.prisma.testnetAccountSnapshot.findMany({
        where: { account_id: accountId },
        orderBy: { timestamp: 'desc' },
        take: limit,
    });
}
/**
 * Get testnet performance metrics
 */
async function getTestnetPerformanceMetrics(accountId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { id: accountId },
    });
    if (!account)
        return null;
    const [closedPositions, fullHistory] = await Promise.all([
        prisma_1.prisma.testnetPosition.findMany({
            where: { account_id: accountId, close_time: { not: null } },
            select: {
                position_id: true,
                side: true,
                close_reason: true,
                realized_pnl: true,
                entry_fee: true,
                exit_fee: true,
                funding_fee: true,
            },
        }),
        (0, account_performance_service_1.getFullHistoryWalletMetrics)(prisma_1.prisma, account),
    ]);
    const trades = (0, account_performance_service_1.calculateClosedTradeMetrics)(closedPositions);
    return {
        ...account,
        total_trades: trades.totalTrades,
        winning_trades: trades.wins,
        losing_trades: trades.losses,
        breakeven_trades: trades.breakeven,
        win_rate: trades.winRate,
        win_rate_all_closed: trades.winRateAllClosed,
        gross_profit: trades.grossProfit,
        gross_loss: trades.grossLoss,
        avg_win: trades.avgWin,
        avg_loss: trades.avgLoss,
        profit_factor: trades.profitFactor,
        avg_r_multiple: trades.avgRMultiple,
        position_pnl: trades.positionPnl,
        stored_fees: trades.storedFees,
        wallet_pnl: fullHistory.walletPnl,
        pnl_gap_vs_positions: fullHistory.walletPnl - trades.positionPnl,
        total_return: fullHistory.walletReturnPercent,
        max_drawdown: fullHistory.maxDrawdownPercent,
        current_drawdown: fullHistory.currentDrawdownPercent,
        full_history: {
            scope: fullHistory.scope,
            baseline_balance: fullHistory.baselineBalance,
            current_balance: fullHistory.currentBalance,
            current_equity: fullHistory.currentEquity,
            wallet_pnl: fullHistory.walletPnl,
            wallet_return_percent: fullHistory.walletReturnPercent,
            peak_equity: fullHistory.peakEquity,
            peak_equity_at: fullHistory.peakEquityAt,
            current_drawdown_percent: fullHistory.currentDrawdownPercent,
            max_drawdown_percent: fullHistory.maxDrawdownPercent,
            max_drawdown_at: fullHistory.maxDrawdownAt,
            first_snapshot_at: fullHistory.firstSnapshotAt,
            last_snapshot_at: fullHistory.lastSnapshotAt,
            snapshot_count: fullHistory.snapshotCount,
        },
    };
}
/**
 * Reset testnet account
 */
async function resetTestnetAccount(accountId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { id: accountId },
    });
    if (!account)
        throw new Error('Account not found');
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            current_balance: account.starting_balance,
            equity: account.starting_balance,
            unrealized_pnl: 0,
            realized_pnl: 0,
            total_trades: 0,
            winning_trades: 0,
            losing_trades: 0,
            max_drawdown: 0,
            consecutive_losses: 0,
            last_trade_time: null,
            cooldown_until: null,
            updated_at: new Date(),
        },
    });
}
/**
 * Get testnet pending orders
 */
async function getTestnetPendingOrders(filters) {
    const where = {};
    if (filters.orderId)
        where.order_id = filters.orderId;
    if (filters.symbol)
        where.symbol = filters.symbol.toUpperCase();
    if (filters.status)
        where.status = filters.status;
    if (filters.accountId)
        where.account_id = filters.accountId;
    if (filters.methodId)
        where.method_id = filters.methodId;
    return prisma_1.prisma.testnetPendingOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
    });
}
/** Pending rows that should block new limit placement until resolved on Binance. */
exports.BLOCKING_PENDING_ORDER_STATUSES = [
    'pending',
    'partially_filled',
    'reconciliation_failed_not_on_binance',
];
async function getBlockingTestnetPendingOrders(filters) {
    const where = {
        status: { in: [...exports.BLOCKING_PENDING_ORDER_STATUSES] },
    };
    if (filters.symbol)
        where.symbol = filters.symbol.toUpperCase();
    if (filters.accountId)
        where.account_id = filters.accountId;
    if (filters.methodId)
        where.method_id = filters.methodId;
    return prisma_1.prisma.testnetPendingOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
    });
}
/**
 * Find pending order by Binance order id (active or recoverable statuses).
 */
async function getTestnetPendingOrderByBinanceId(binanceOrderId, symbol) {
    return prisma_1.prisma.testnetPendingOrder.findFirst({
        where: {
            binance_order_id: binanceOrderId,
            ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
            status: {
                in: ['pending', 'partially_filled', 'reconciliation_failed_not_on_binance'],
            },
        },
    });
}
/** Lookup by internal order_id (from clientOrderId x-v3_*). */
async function getTestnetPendingOrderByOrderId(orderId) {
    return prisma_1.prisma.testnetPendingOrder.findFirst({
        where: {
            order_id: orderId,
            status: {
                in: ['pending', 'partially_filled', 'reconciliation_failed_not_on_binance'],
            },
        },
    });
}
/**
 * Execute testnet pending order
 */
async function executeTestnetPendingOrder(orderId, _positionId) {
    await prisma_1.prisma.testnetPendingOrder.update({
        where: { order_id: orderId },
        data: {
            status: 'executed',
            executed_at: new Date(),
        },
    });
}
/**
 * Cancel testnet pending order
 */
async function cancelTestnetPendingOrder(orderId, reason = 'cancelled') {
    await prisma_1.prisma.testnetPendingOrder.update({
        where: { order_id: orderId },
        data: {
            status: `cancelled_${reason}`,
        },
    });
}
/**
 * Update testnet pending order
 */
async function updateTestnetPendingOrder(orderId, updates) {
    await prisma_1.prisma.testnetPendingOrder.update({
        where: { order_id: orderId },
        data: updates,
    });
}
/**
 * Create testnet pending order
 */
async function createTestnetPendingOrder(data) {
    return prisma_1.prisma.testnetPendingOrder.create({
        data: {
            order_id: data.orderId,
            account_id: data.accountId,
            symbol: data.symbol.toUpperCase(),
            side: data.side,
            entry_price: data.entryPrice,
            stop_loss: data.stopLoss,
            take_profit: data.takeProfit,
            size_usd: data.sizeUsd,
            size_qty: data.sizeQty,
            risk_usd: data.riskUsd,
            risk_percent: data.riskPercent,
            expected_rr: data.expectedRr,
            linked_prediction_id: data.linkedPredictionId,
            invalidation_level: data.invalidationLevel,
            method_id: data.methodId || 'ict',
            status: 'pending',
            created_at: new Date(),
            binance_order_id: data.binanceOrderId,
        },
    });
}
/**
 * Update precision error tracking
 */
async function updatePrecisionError(accountId, errorCode, errorMessage) {
    const now = new Date();
    const account = await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            precision_error_count: { increment: 1 },
            last_precision_error_time: now,
            last_precision_error_code: errorCode,
            last_precision_error_message: errorMessage,
            updated_at: now,
        },
    });
    // Check if cooldown should be triggered
    if (account.precision_error_count >= 3) {
        const lastErrorTime = account.last_precision_error_time ? new Date(account.last_precision_error_time) : null;
        if (lastErrorTime && Date.now() - lastErrorTime.getTime() < 10 * 60 * 1000) {
            const cooldownMinutes = Math.min(5 * Math.pow(2, account.precision_error_count - 3), 30);
            const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000);
            await prisma_1.prisma.testnetAccount.update({
                where: { id: accountId },
                data: {
                    precision_cooldown_until: cooldownUntil,
                },
            });
            return { ...account, precision_cooldown_until: cooldownUntil };
        }
    }
    return account;
}
/**
 * Reset precision error tracking
 */
async function resetPrecisionErrorTracking(accountId) {
    const now = new Date();
    return prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            precision_error_count: 0,
            precision_cooldown_until: null,
            last_precision_error_time: null,
            last_precision_error_code: null,
            last_precision_error_message: null,
            updated_at: now,
        },
    });
}
//# sourceMappingURL=testnet.repository.js.map