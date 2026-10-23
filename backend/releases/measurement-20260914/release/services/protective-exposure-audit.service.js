"use strict";
/**
 * Independent P0 guard: live Binance exposure must have exchange-side SL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectiveAuditStartupDelayMs = void 0;
exports.classifyProtectiveCoverage = classifyProtectiveCoverage;
exports.auditProtectiveCoverageForSymbol = auditProtectiveCoverageForSymbol;
exports.auditProtectiveCoverageForSymbols = auditProtectiveCoverageForSymbols;
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binanceClient_1 = require("./binanceClient");
const binance_order_fill_service_1 = require("./binance-order-fill.service");
const binance_exposure_service_1 = require("./binance-exposure.service");
const position_close_service_1 = require("./position-close.service");
const protective_order_service_1 = require("./protective-order.service");
const telegram_notify_service_1 = require("./telegram/telegram-notify.service");
const protective_exposure_state_1 = require("./protective-exposure-state");
const position_lifecycle_guard_service_1 = require("./position-lifecycle-guard.service");
const MIN_AMT = 1e-8;
function pairSymbol(symbol) {
    return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}
function auditEnabled() {
    return process.env.PROTECTIVE_EXPOSURE_AUDIT_ENABLED !== 'false';
}
function entryBlockTtlMs() {
    const raw = parseInt(process.env.PROTECTIVE_EXPOSURE_ENTRY_BLOCK_MS || '600000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 600000;
}
var position_lifecycle_guard_service_2 = require("./position-lifecycle-guard.service");
Object.defineProperty(exports, "protectiveAuditStartupDelayMs", { enumerable: true, get: function () { return position_lifecycle_guard_service_2.protectiveAuditStartupDelayMs; } });
function algoId(order) {
    const id = order.algoId ?? order.orderId;
    return id == null ? null : String(id);
}
function algoType(order) {
    return String(order.orderType ?? order.type ?? '').toUpperCase();
}
function isMatchingPositionSide(order, position) {
    const ps = String(order.positionSide ?? '').toUpperCase();
    if (!ps || ps === 'BOTH')
        return true;
    return ps === (position.side === 'long' ? 'LONG' : 'SHORT');
}
function classifyProtectiveCoverage(position, orders) {
    const closeSide = position.side === 'long' ? 'SELL' : 'BUY';
    const symbolUsdt = pairSymbol(position.symbol);
    const coverage = {
        stopLossId: null,
        takeProfitId: null,
        stopLossCount: 0,
        takeProfitCount: 0,
    };
    for (const order of orders) {
        if (String(order.symbol ?? '').toUpperCase() !== symbolUsdt)
            continue;
        if (String(order.side ?? '').toUpperCase() !== closeSide)
            continue;
        if (!isMatchingPositionSide(order, position))
            continue;
        const t = algoType(order);
        const id = algoId(order);
        if (!id)
            continue;
        if (t.includes('TAKE_PROFIT')) {
            coverage.takeProfitCount += 1;
            coverage.takeProfitId ??= id;
        }
        else if (t.includes('STOP')) {
            coverage.stopLossCount += 1;
            coverage.stopLossId ??= id;
        }
    }
    return coverage;
}
async function findLocalOpenPosition(position) {
    return prisma_1.prisma.testnetPosition.findFirst({
        where: {
            symbol: position.symbol,
            side: position.side,
            status: 'open',
        },
        include: { account: true },
        orderBy: { entry_time: 'desc' },
    });
}
/**
 * Pending limit fill may exist on Binance before local position + SL/TP are written.
 * Recover or defer — never emergency-close during that window.
 */
async function tryRecoverOrDeferUntrackedExposure(position) {
    const blocking = await (0, position_lifecycle_guard_service_1.findBlockingPendingForSymbol)(position.symbol, position.side);
    if (blocking) {
        const outcome = await (0, binance_order_fill_service_1.recoverPendingOrderFromBinance)(blocking);
        if (outcome === 'filled') {
            console.log(`[ProtectiveExposureAudit] Recovered fill from pending ${blocking.order_id} for ${position.symbol} ${position.side}`);
            return 'recovered';
        }
        if (outcome === 'api_unavailable' ||
            outcome === 'unchanged' ||
            blocking.status === 'pending' ||
            blocking.status === 'partially_filled') {
            console.log(`[ProtectiveExposureAudit] Defer emergency close for ${position.symbol} ${position.side} — ` +
                `pending ${blocking.order_id} (${outcome})`);
            return 'deferred';
        }
    }
    const recentExecuted = await (0, position_lifecycle_guard_service_1.findRecentlyExecutedPending)(position.symbol, position.side);
    if (recentExecuted) {
        console.log(`[ProtectiveExposureAudit] Defer emergency close for ${position.symbol} ${position.side} — ` +
            `recent executed pending ${recentExecuted.order_id}`);
        return 'deferred';
    }
    return 'none';
}
async function ensurePipelineAnchor() {
    const account = await (0, testnet_repository_1.getOrCreateTestnetAccount)('BTC', 'kim_nghia', 10000);
    await (0, testnet_repository_1.ensurePipelineEventPosition)(account.id);
}
async function recordAuditEvent(eventData) {
    try {
        await ensurePipelineAnchor();
        await (0, testnet_repository_1.recordTestnetTradeEvent)(testnet_repository_1.PIPELINE_EVENT_POSITION_ID, 'protective_exposure_audit', eventData);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[ProtectiveExposureAudit] event write failed: ${msg}`);
    }
}
async function closeUntrackedExposure(position, reason) {
    const closeResult = await (0, position_close_service_1.closePositionOnBinanceMarket)({
        symbol: position.symbol,
        side: position.side,
        size_qty: position.positionAmt,
    }, undefined, { guardSource: 'protective_exposure_audit' });
    await (0, testnet_repository_1.recordPipelineEvent)('untracked_exposure_protective_close', {
        symbol: position.symbol,
        side: position.side,
        size_qty: position.positionAmt,
        reason,
        close_ok: closeResult.ok,
        close_error: closeResult.reason,
        timestamp: new Date().toISOString(),
    });
    if (!closeResult.ok) {
        const deferred = closeResult.reason?.includes('warmup') ||
            closeResult.reason?.includes('pending') ||
            closeResult.reason?.includes('grace') ||
            closeResult.reason?.includes('lifecycle_guard');
        if (deferred) {
            console.log(`[ProtectiveExposureAudit] Deferred untracked close ${position.symbol} ${position.side}: ${closeResult.reason}`);
            return false;
        }
        (0, protective_exposure_state_1.setProtectiveExposureEntryBlock)(`Unprotected ${position.symbol} ${position.side} exposure; emergency close failed: ${closeResult.reason}`, entryBlockTtlMs());
        (0, telegram_notify_service_1.notifyAlert)('Unprotected exposure close failed', `${position.symbol} ${position.side} qty=${position.positionAmt}: ${closeResult.reason}`, `protective-audit-close-failed:${position.symbol}:${position.side}`, 300000);
        return false;
    }
    (0, telegram_notify_service_1.notifyAlert)('Untracked exposure closed', `${position.symbol} ${position.side} qty=${position.positionAmt}: ${reason}`, `protective-audit-closed:${position.symbol}:${position.side}`, 300000);
    return true;
}
async function repairLocalPosition(local, coverage, position) {
    if (!local)
        return false;
    const outcome = await (0, protective_order_service_1.placeProtectiveOrdersForPosition)(local);
    await recordAuditEvent({
        symbol: position.symbol,
        side: position.side,
        position_id: local.position_id,
        issue: !coverage.stopLossId ? 'missing_sl' : 'missing_tp',
        outcome,
        live_sl_id: coverage.stopLossId,
        live_tp_id: coverage.takeProfitId,
        timestamp: new Date().toISOString(),
    });
    return outcome === 'ok' || outcome === 'closed' || outcome === 'skipped';
}
async function auditProtectiveCoverageForSymbol(symbol) {
    if (process.env.BINANCE_ENABLED !== 'true' || !auditEnabled()) {
        return { checked: 0, repaired: 0, closed: 0, blocked: false };
    }
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    const active = await (0, binance_exposure_service_1.fetchActiveBinancePositions)(base);
    const positions = active.filter((p) => p.symbol === base && p.positionAmt > MIN_AMT);
    if (positions.length === 0) {
        return { checked: 0, repaired: 0, closed: 0, blocked: false };
    }
    let orders = [];
    try {
        orders = await (0, binanceClient_1.getOpenAlgoOrders)({}, pairSymbol(base));
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        (0, protective_exposure_state_1.setProtectiveExposureEntryBlock)(`Cannot verify protective orders for ${base}: ${msg}`, entryBlockTtlMs());
        (0, telegram_notify_service_1.notifyAlert)('Protective audit failed', `${base}: openAlgoOrders failed: ${msg}`, `protective-audit-open-algo:${base}`, 300000);
        return { checked: positions.length, repaired: 0, closed: 0, blocked: true };
    }
    let repaired = 0;
    let closed = 0;
    let blocked = false;
    for (const position of positions) {
        const coverage = classifyProtectiveCoverage(position, orders);
        if (coverage.stopLossId && coverage.takeProfitId) {
            continue;
        }
        const local = await findLocalOpenPosition(position);
        if (!coverage.stopLossId) {
            const repairedLocal = local ? await repairLocalPosition(local, coverage, position) : false;
            if (repairedLocal) {
                repaired += 1;
                continue;
            }
            if (!local) {
                const recoverOrDefer = await tryRecoverOrDeferUntrackedExposure(position);
                if (recoverOrDefer === 'recovered') {
                    repaired += 1;
                    continue;
                }
                if (recoverOrDefer === 'deferred') {
                    continue;
                }
                const ok = await closeUntrackedExposure(position, 'missing_sl_no_local_position');
                if (ok) {
                    closed += 1;
                    continue;
                }
            }
            blocked = true;
            (0, protective_exposure_state_1.setProtectiveExposureEntryBlock)(`Unprotected ${position.symbol} ${position.side} exposure missing SL`, entryBlockTtlMs());
            (0, telegram_notify_service_1.notifyAlert)('Unprotected exposure', `${position.symbol} ${position.side} qty=${position.positionAmt} missing SL`, `protective-audit-missing-sl:${position.symbol}:${position.side}`, 300000);
            continue;
        }
        if (!coverage.takeProfitId) {
            if (local) {
                const ok = await repairLocalPosition(local, coverage, position);
                if (ok)
                    repaired += 1;
            }
            else {
                await recordAuditEvent({
                    symbol: position.symbol,
                    side: position.side,
                    issue: 'missing_tp_no_local_position',
                    live_sl_id: coverage.stopLossId,
                    timestamp: new Date().toISOString(),
                });
                (0, telegram_notify_service_1.notifyAlert)('Protective TP missing', `${position.symbol} ${position.side} has SL ${coverage.stopLossId} but no TP and no local position`, `protective-audit-missing-tp:${position.symbol}:${position.side}`, 300000);
            }
        }
    }
    return { checked: positions.length, repaired, closed, blocked };
}
async function auditProtectiveCoverageForSymbols(symbols) {
    let anyBlocked = false;
    for (const symbol of symbols) {
        try {
            const result = await auditProtectiveCoverageForSymbol(symbol);
            anyBlocked ||= result.blocked;
            if (result.checked > 0 || result.repaired > 0 || result.closed > 0 || result.blocked) {
                console.log(`[ProtectiveExposureAudit] ${symbol}: checked=${result.checked} repaired=${result.repaired} closed=${result.closed} blocked=${result.blocked}`);
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[ProtectiveExposureAudit] ${symbol} failed: ${msg}`);
        }
    }
    if (!anyBlocked) {
        (0, protective_exposure_state_1.clearProtectiveExposureEntryBlock)();
    }
}
//# sourceMappingURL=protective-exposure-audit.service.js.map