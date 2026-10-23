"use strict";
/**
 * Position Monitor Scheduler
 * Monitors open positions — conservative: prefer exchange SL/TP, max one reduce.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPositionMonitorScheduler = startPositionMonitorScheduler;
exports.stopPositionMonitorScheduler = stopPositionMonitorScheduler;
exports.runManualPositionMonitor = runManualPositionMonitor;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const position_mark_1 = require("../services/position-mark");
const position_close_service_1 = require("../services/position-close.service");
const scheduler_heartbeat_1 = require("../utils/scheduler-heartbeat");
const position_mark_persist_1 = require("../utils/position-mark-persist");
const testnet_repository_2 = require("../repositories/testnet.repository");
const position_health_analyzer_1 = require("../analyzers/position-health.analyzer");
const binance_balance_sync_service_1 = require("../services/binance-balance-sync.service");
const position_monitor_policy_1 = require("../config/position-monitor-policy");
const protective_order_service_1 = require("../services/protective-order.service");
const profit_protect_service_1 = require("../services/profit-protect.service");
const position_invalidation_service_1 = require("../services/position-invalidation.service");
const profit_protect_policy_1 = require("../config/profit-protect-policy");
const position_invalidation_policy_1 = require("../config/position-invalidation-policy");
let positionMonitorTask = null;
let isRunning = false;
/** Avoid spamming Binance when reduce/close qty cannot be normalized. */
const precisionSkipUntil = new Map();
const REDUCE_FRACTION = 0.5;
function isPositionMonitorEnabled() {
    return process.env.POSITION_MONITOR_ENABLED !== 'false';
}
function shouldSkipPrecisionAction(positionId) {
    const until = precisionSkipUntil.get(positionId);
    return until != null && Date.now() < until;
}
function markPrecisionSkip(positionId, reason) {
    const ms = (0, position_monitor_policy_1.getPrecisionSkipMs)();
    precisionSkipUntil.set(positionId, Date.now() + ms);
    console.warn(`[PositionMonitor] Skipping reduce/close for ${positionId} for ${Math.round(ms / 60000)}m: ${reason}`);
}
/** At most one monitor-driven reduce per position. */
function canReduceAgain(position) {
    return (position.partial_closed ?? 0) < 0.01;
}
function hasExchangeSlTp(position) {
    return Boolean(position.binance_sl_order_id && position.binance_tp_order_id);
}
function toPositionData(position) {
    const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
    return {
        position_id: position.position_id,
        symbol: position.symbol,
        side,
        entry_price: position.entry_price,
        current_price: position.current_price,
        stop_loss: position.stop_loss,
        take_profit: position.take_profit,
        entry_time: position.entry_time,
        size_qty: position.size_qty,
        unrealized_pnl: position.unrealized_pnl,
    };
}
async function runPositionMonitor() {
    if (!isPositionMonitorEnabled()) {
        return;
    }
    if (isRunning) {
        console.warn('[PositionMonitor] Previous monitor still running, skipping cycle');
        return;
    }
    isRunning = true;
    (0, scheduler_heartbeat_1.recordSchedulerRun)('PositionMonitor');
    try {
        console.log('[PositionMonitor] Starting position monitor');
        const openPositions = await prisma_1.prisma.testnetPosition.findMany({
            where: {
                status: { in: ['open', 'reconciliation_failed_not_on_binance'] },
            },
            include: { account: true },
        });
        console.log(`[PositionMonitor] Found ${openPositions.length} open positions`);
        for (const position of openPositions) {
            if (position.position_id === testnet_repository_2.PIPELINE_EVENT_POSITION_ID ||
                String(position.side).toUpperCase() === 'NONE') {
                continue;
            }
            const mark = await (0, position_mark_1.resolveMarkPrice)(position.symbol, position.current_price || position.entry_price);
            const storedMark = position.current_price || position.entry_price;
            const qty = Math.abs(position.size_qty);
            let markUnrealized = 0;
            if (position.side === 'long') {
                markUnrealized = (mark - position.entry_price) * qty;
            }
            else {
                markUnrealized = (position.entry_price - mark) * qty;
            }
            let refreshed = position;
            if ((0, position_mark_persist_1.shouldPersistPositionMark)(position.position_id, mark, storedMark, markUnrealized, position.unrealized_pnl || 0)) {
                await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
                    current_price: mark,
                    unrealized_pnl: markUnrealized,
                });
                (0, position_mark_persist_1.notePositionMarkPersisted)(position.position_id);
                const row = await prisma_1.prisma.testnetPosition.findUnique({
                    where: { position_id: position.position_id },
                    include: { account: true },
                });
                if (!row || row.status !== 'open')
                    continue;
                refreshed = row;
            }
            else {
                refreshed = { ...position, current_price: mark, unrealized_pnl: markUnrealized };
            }
            if (refreshed.status !== 'open')
                continue;
            // Profit protect: tighten exchange SL (BE / trail) — runs even when deferring exit to SL/TP.
            if ((0, profit_protect_policy_1.isProfitProtectEnabled)() && refreshed.binance_sl_order_id) {
                try {
                    const protect = await (0, profit_protect_service_1.maybeApplyProfitProtectSl)(refreshed, mark);
                    if (protect.applied && protect.newSl != null) {
                        refreshed = {
                            ...refreshed,
                            stop_loss: protect.newSl,
                        };
                    }
                }
                catch (protectErr) {
                    const msg = protectErr instanceof Error ? protectErr.message : String(protectErr);
                    console.warn(`[PositionMonitor] Profit protect failed for ${refreshed.position_id}: ${msg}`);
                }
            }
            // Structure invalidation: BE when green; market exit when red + score≥min.
            if ((0, position_invalidation_policy_1.isInvalidationEnabled)()) {
                try {
                    const inv = await (0, position_invalidation_service_1.maybeApplyInvalidationProtect)(refreshed, mark);
                    if (inv.exited) {
                        console.log(`[PositionMonitor] Invalidation exit for ${refreshed.position_id}: ${inv.reason}`);
                        continue;
                    }
                    if (inv.applied && inv.newSl != null) {
                        refreshed = { ...refreshed, stop_loss: inv.newSl };
                    }
                }
                catch (invErr) {
                    const msg = invErr instanceof Error ? invErr.message : String(invErr);
                    console.warn(`[PositionMonitor] Invalidation failed for ${refreshed.position_id}: ${msg}`);
                }
            }
            const exchangeActive = (0, position_monitor_policy_1.deferToExchangeSlTp)() && hasExchangeSlTp(refreshed);
            const health = (0, position_health_analyzer_1.analyzePositionHealth)(toPositionData(refreshed), {
                partial_closed: refreshed.partial_closed ?? 0,
                exchange_sl_tp_active: exchangeActive,
                min_minutes_before_action: (0, position_monitor_policy_1.getMinMinutesBeforeMonitorAction)(),
                min_pnl_percent_for_action: (0, position_monitor_policy_1.getMinPnlPercentForMonitorAction)(),
            });
            const unrealizedPnl = markUnrealized;
            console.log(`[PositionMonitor] ${position.symbol} ${position.side}: ${health.health.toUpperCase()}`);
            console.log(`[PositionMonitor] PnL: ${unrealizedPnl.toFixed(2)} (${health.pnl_percent.toFixed(2)}%), sl_progress: ${health.sl_progress != null ? (health.sl_progress * 100).toFixed(0) + '%' : 'n/a'}, Action: ${health.recommended_action}`);
            console.log(`[PositionMonitor] Reason: ${health.reason}`);
            if (health.recommended_action === 'exit') {
                const unhedged = !refreshed.binance_sl_order_id && process.env.BINANCE_ENABLED === 'true';
                const allowUnhedgedExit = unhedged &&
                    (0, position_monitor_policy_1.isUnhedgedEmergencyExitEnabled)() &&
                    health.sl_progress != null &&
                    health.sl_progress >= 0.95;
                if (!(0, position_monitor_policy_1.isPositionMonitorExitEnabled)() && !allowUnhedgedExit) {
                    console.log(`[PositionMonitor] EXIT skipped (POSITION_MONITOR_ALLOW_EXIT=false) for ${position.position_id}`);
                    continue;
                }
                if (allowUnhedgedExit && !(0, position_monitor_policy_1.isPositionMonitorExitEnabled)()) {
                    console.warn(`[PositionMonitor] Unhedged emergency exit for ${position.position_id} (no binance SL)`);
                    const closed = await (0, protective_order_service_1.emergencyMarketCloseUnhedged)(refreshed, mark, 'monitor_unhedged_sl_progress');
                    if (closed)
                        continue;
                }
                if (shouldSkipPrecisionAction(position.position_id)) {
                    continue;
                }
                const closeResult = await (0, position_close_service_1.closePositionOnBinanceMarket)(refreshed, undefined, {
                    guardSource: 'position_monitor_exit',
                    positionId: refreshed.position_id,
                    entryTime: refreshed.entry_time ?? null,
                });
                if (!closeResult.ok) {
                    markPrecisionSkip(position.position_id, closeResult.reason ?? 'exit close failed');
                    continue;
                }
                await (0, position_close_service_1.closeLocalPosition)({ ...refreshed, account: refreshed.account }, mark, 'position_monitor_exit');
                if (process.env.BINANCE_ENABLED === 'true') {
                    try {
                        await (0, binance_balance_sync_service_1.syncTestnetAccountFromBinance)(position.account_id);
                    }
                    catch (syncErr) {
                        const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
                        console.warn(`[PositionMonitor] Balance sync after exit failed: ${msg}`);
                    }
                }
            }
            else if (health.recommended_action === 'reduce') {
                if (!(0, position_monitor_policy_1.isPositionMonitorReduceEnabled)()) {
                    console.log(`[PositionMonitor] REDUCE skipped (POSITION_MONITOR_ALLOW_REDUCE not true) for ${position.position_id}`);
                    continue;
                }
                if (!canReduceAgain(refreshed)) {
                    console.log(`[PositionMonitor] REDUCE skipped — already reduced (partial_closed=${refreshed.partial_closed}) for ${position.position_id}`);
                    continue;
                }
                if (shouldSkipPrecisionAction(position.position_id)) {
                    continue;
                }
                const totalQty = Math.abs(refreshed.size_qty);
                const reduceQty = totalQty * REDUCE_FRACTION;
                if (reduceQty <= 0) {
                    console.log(`[PositionMonitor] REDUCE skipped — qty too small for ${position.position_id}`);
                    continue;
                }
                const closeResult = await (0, position_close_service_1.closePositionOnBinanceMarket)(refreshed, reduceQty, {
                    guardSource: 'position_monitor_reduce',
                    positionId: refreshed.position_id,
                    entryTime: refreshed.entry_time ?? null,
                });
                if (!closeResult.ok) {
                    markPrecisionSkip(position.position_id, closeResult.reason ?? 'reduce close failed');
                    continue;
                }
                const closedQty = closeResult.normalizedQty ?? reduceQty;
                const remainingQty = Math.max(0, totalQty - closedQty);
                const sizeUsd = refreshed.size_usd > 0
                    ? (refreshed.size_usd * remainingQty) / totalQty
                    : remainingQty * mark;
                await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
                    size_qty: refreshed.side === 'short' ? -remainingQty : remainingQty,
                    size_usd: sizeUsd,
                    current_price: mark,
                    partial_closed: 1,
                });
                console.log(`[PositionMonitor] Reduced ${position.position_id} once (remaining qty ${remainingQty}, partial_closed=1.00)`);
                if (process.env.BINANCE_ENABLED === 'true') {
                    try {
                        await (0, binance_balance_sync_service_1.syncTestnetAccountFromBinance)(position.account_id);
                    }
                    catch (syncErr) {
                        const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
                        console.warn(`[PositionMonitor] Balance sync after reduce failed: ${msg}`);
                    }
                }
            }
        }
        console.log('[PositionMonitor] Position monitor completed');
    }
    catch (error) {
        console.error('[PositionMonitor] Error during position monitor:', error);
    }
    finally {
        isRunning = false;
    }
}
function startPositionMonitorScheduler(cronExpression = '*/1 * * * *') {
    if (positionMonitorTask) {
        console.warn('[PositionMonitor] Scheduler already running');
        return;
    }
    console.log(`[PositionMonitor] Starting scheduler cron=${cronExpression} enabled=${isPositionMonitorEnabled()} ` +
        `allow_reduce=${(0, position_monitor_policy_1.isPositionMonitorReduceEnabled)()} allow_exit=${(0, position_monitor_policy_1.isPositionMonitorExitEnabled)()} ` +
        `defer_sl_tp=${(0, position_monitor_policy_1.deferToExchangeSlTp)()} profit_protect=${(0, profit_protect_policy_1.isProfitProtectEnabled)()} ` +
        `invalidation=${(0, position_invalidation_policy_1.isInvalidationEnabled)()}`);
    positionMonitorTask = node_cron_1.default.schedule(cronExpression, runPositionMonitor);
    runPositionMonitor();
}
function stopPositionMonitorScheduler() {
    if (positionMonitorTask) {
        positionMonitorTask.stop();
        positionMonitorTask = null;
        console.log('[PositionMonitor] Scheduler stopped');
    }
}
async function runManualPositionMonitor() {
    return await runPositionMonitor();
}
//# sourceMappingURL=position-monitor.scheduler.js.map