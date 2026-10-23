"use strict";
/**
 * Central guards against premature Binance market closes and false bookkeeping closes
 * during fill → materialize → protective-order pipeline (deploy/restart races).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.markWorkerStarted = markWorkerStarted;
exports.fillGraceMs = fillGraceMs;
exports.newPositionGraceMs = newPositionGraceMs;
exports.workerWarmupMs = workerWarmupMs;
exports.emergencyCloseMemoryMs = emergencyCloseMemoryMs;
exports.protectiveAuditStartupDelayMs = protectiveAuditStartupDelayMs;
exports.isWorkerInWarmup = isWorkerInWarmup;
exports.noteEmergencyMarketClose = noteEmergencyMarketClose;
exports.wasRecentEmergencyMarketClose = wasRecentEmergencyMarketClose;
exports.findBlockingPendingForSymbol = findBlockingPendingForSymbol;
exports.findRecentlyExecutedPending = findRecentlyExecutedPending;
exports.shouldDeferEmergencyMarketClose = shouldDeferEmergencyMarketClose;
exports.shouldDeferAbsentOnBinanceBookkeepingClose = shouldDeferAbsentOnBinanceBookkeepingClose;
exports.shouldSkipMaterializeWithoutLiveExposure = shouldSkipMaterializeWithoutLiveExposure;
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
let workerStartedAtMs = Date.now();
const recentEmergencyCloses = new Map();
function envMs(name, fallback) {
    const raw = parseInt(process.env[name] || String(fallback), 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}
function markWorkerStarted() {
    workerStartedAtMs = Date.now();
}
function fillGraceMs() {
    return envMs('PROTECTIVE_AUDIT_FILL_GRACE_MS', 180_000);
}
function newPositionGraceMs() {
    return envMs('POSITION_NEW_GRACE_MS', 300_000);
}
function workerWarmupMs() {
    return envMs('PROTECTIVE_AUDIT_STARTUP_DELAY_MS', 90_000);
}
function emergencyCloseMemoryMs() {
    return envMs('POSITION_EMERGENCY_CLOSE_MEMORY_MS', 300_000);
}
function protectiveAuditStartupDelayMs() {
    return workerWarmupMs();
}
function isWorkerInWarmup() {
    return Date.now() - workerStartedAtMs < workerWarmupMs();
}
function exposureKey(symbol, side) {
    return `${symbol.toUpperCase()}:${side.toLowerCase()}`;
}
function noteEmergencyMarketClose(symbol, side, source) {
    recentEmergencyCloses.set(exposureKey(symbol, side), Date.now());
    console.log(`[LifecycleGuard] Noted emergency market close ${symbol} ${side} (source=${source})`);
}
function wasRecentEmergencyMarketClose(symbol, side, windowMs = emergencyCloseMemoryMs()) {
    const at = recentEmergencyCloses.get(exposureKey(symbol, side));
    return at != null && Date.now() - at < windowMs;
}
function isRecentTimestamp(ts, windowMs) {
    if (!ts)
        return false;
    return Date.now() - ts.getTime() < windowMs;
}
async function findBlockingPendingForSymbol(symbol, side) {
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    return prisma_1.prisma.testnetPendingOrder.findFirst({
        where: {
            symbol: base,
            ...(side ? { side: side.toLowerCase() } : {}),
            status: { in: [...testnet_repository_1.BLOCKING_PENDING_ORDER_STATUSES] },
        },
        orderBy: { created_at: 'desc' },
    });
}
async function findRecentlyExecutedPending(symbol, side) {
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    const since = new Date(Date.now() - fillGraceMs());
    return prisma_1.prisma.testnetPendingOrder.findFirst({
        where: {
            symbol: base,
            ...(side ? { side: side.toLowerCase() } : {}),
            status: { in: ['executed', 'executed_historical'] },
            executed_at: { gte: since },
        },
        orderBy: { executed_at: 'desc' },
    });
}
async function shouldDeferEmergencyMarketClose(input) {
    const side = input.side.toLowerCase() === 'short' ? 'short' : 'long';
    const symbol = input.symbol.toUpperCase().replace(/USDT$/i, '');
    if (isWorkerInWarmup()) {
        return {
            defer: true,
            reason: `worker warmup (${workerWarmupMs()}ms since start)`,
        };
    }
    const blocking = await findBlockingPendingForSymbol(symbol, side);
    if (blocking) {
        return {
            defer: true,
            reason: `blocking pending order ${blocking.order_id} (${blocking.status})`,
        };
    }
    const recentExecuted = await findRecentlyExecutedPending(symbol, side);
    if (recentExecuted) {
        return {
            defer: true,
            reason: `recent executed pending ${recentExecuted.order_id}`,
        };
    }
    if (isRecentTimestamp(input.entryTime, newPositionGraceMs())) {
        return {
            defer: true,
            reason: `position entry within new-position grace (${newPositionGraceMs()}ms)`,
        };
    }
    if (input.positionId) {
        const row = await prisma_1.prisma.testnetPosition.findUnique({
            where: { position_id: input.positionId },
            select: { entry_time: true, binance_sl_order_id: true, binance_tp_order_id: true },
        });
        if (row && isRecentTimestamp(row.entry_time, newPositionGraceMs())) {
            const unhedged = !row.binance_sl_order_id && !row.binance_tp_order_id;
            if (unhedged) {
                return {
                    defer: true,
                    reason: `new unhedged position ${input.positionId} still within protective grace`,
                };
            }
        }
    }
    return { defer: false };
}
async function shouldDeferAbsentOnBinanceBookkeepingClose(position) {
    const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
    const symbol = position.symbol.toUpperCase().replace(/USDT$/i, '');
    if (isWorkerInWarmup()) {
        return { defer: true, reason: 'worker warmup' };
    }
    if (isRecentTimestamp(position.entry_time ?? null, newPositionGraceMs())) {
        return {
            defer: true,
            reason: `position ${position.position_id} opened within new-position grace`,
        };
    }
    if (wasRecentEmergencyMarketClose(symbol, side)) {
        return {
            defer: true,
            reason: `recent emergency market close on ${symbol} ${side}`,
        };
    }
    const blocking = await findBlockingPendingForSymbol(symbol, side);
    if (blocking) {
        return {
            defer: true,
            reason: `blocking pending ${blocking.order_id} for ${symbol} ${side}`,
        };
    }
    const recentExecuted = await findRecentlyExecutedPending(symbol, side);
    if (recentExecuted) {
        return {
            defer: true,
            reason: `recent executed pending ${recentExecuted.order_id}`,
        };
    }
    return { defer: false };
}
/** Do not materialize an open row when Binance exposure is already gone (audit race). */
async function shouldSkipMaterializeWithoutLiveExposure(symbol, side) {
    const localSide = side.toLowerCase() === 'short' ? 'short' : 'long';
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    if (wasRecentEmergencyMarketClose(base, localSide)) {
        return {
            defer: true,
            reason: `recent emergency close on ${base} ${localSide}`,
        };
    }
    const blocking = await findBlockingPendingForSymbol(base, localSide);
    if (blocking && blocking.status === 'pending') {
        return { defer: false };
    }
    return { defer: false };
}
//# sourceMappingURL=position-lifecycle-guard.service.js.map