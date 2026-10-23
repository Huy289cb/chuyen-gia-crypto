"use strict";
/**
 * Shared entry eligibility for LLM dispatch and V3 execution (scale-in within exposure cap).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.oppositeLocalSide = oppositeLocalSide;
exports.getSymbolExposureSnapshot = getSymbolExposureSnapshot;
exports.assertSameSidePostCloseCooldown = assertSameSidePostCloseCooldown;
exports.canRunLlmDispatchForSymbol = canRunLlmDispatchForSymbol;
exports.assertScaleInSideAllowed = assertScaleInSideAllowed;
const risk_policy_1 = require("../config/risk-policy");
const pending_order_policy_1 = require("../config/pending-order-policy");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const prisma_1 = require("../lib/prisma");
const binance_exposure_service_1 = require("./binance-exposure.service");
const account_risk_guard_service_1 = require("./account-risk-guard.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
function oppositeLocalSide(side) {
    return side === 'long' ? 'short' : 'long';
}
async function getSymbolExposureSnapshot(symbol, methodId = 'kim_nghia') {
    const [openPositions, pendingOrders, account] = await Promise.all([
        (0, testnet_repository_1.getActiveTestnetPositions)({ symbol, methodId }),
        (0, testnet_repository_1.getBlockingTestnetPendingOrders)({ symbol, methodId }),
        (0, testnet_repository_1.getOrCreateTestnetAccount)(symbol, methodId, 10000),
    ]);
    const balance = Number(account.current_balance ?? account.equity ?? 10000);
    const riskPolicy = (0, risk_policy_1.getRiskPolicy)();
    const maxExposureUsd = (0, v3_entry_policy_1.resolveMaxTotalExposureUsd)(balance, riskPolicy.maxTotalExposureUsd);
    const openUsd = openPositions.reduce((sum, p) => sum + Math.abs(Number(p.size_usd) || 0), 0);
    const pendingUsd = pendingOrders.reduce((sum, o) => sum + Math.abs(Number(o.size_usd) || 0), 0);
    const totalUsd = openUsd + pendingUsd;
    const openSides = [
        ...new Set(openPositions
            .map((p) => String(p.side).toLowerCase())
            .filter((s) => s === 'long' || s === 'short')),
    ];
    const pendingSides = [
        ...new Set(pendingOrders
            .map((o) => String(o.side).toLowerCase())
            .filter((s) => s === 'long' || s === 'short')),
    ];
    return {
        openUsd,
        pendingUsd,
        totalUsd,
        maxExposureUsd,
        remainingUsd: Math.max(0, maxExposureUsd - totalUsd),
        openSides,
        pendingSides,
    };
}
async function hasRecentPendingCancelCooldown(symbol) {
    const cooldownMin = (0, pending_order_policy_1.getPendingOrderReentryCooldownMinutes)();
    if (!(cooldownMin > 0))
        return null;
    const since = new Date(Date.now() - cooldownMin * 60_000);
    const events = await prisma_1.prisma.testnetTradeEvent.findMany({
        where: {
            position_id: testnet_repository_1.PIPELINE_EVENT_POSITION_ID,
            event_type: 'pending_order_cancelled',
            timestamp: { gte: since },
        },
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: { event_data: true, timestamp: true },
    });
    const sym = symbol.toUpperCase();
    for (const ev of events) {
        if (!ev.event_data) {
            // BTC-only production: treat unscoped cancel as blocking.
            return `pending re-entry cooldown ${cooldownMin}m after cancel`;
        }
        try {
            const data = JSON.parse(ev.event_data);
            if (!data.symbol || String(data.symbol).toUpperCase().replace(/USDT$/i, '') === sym) {
                const ago = Math.ceil((Date.now() - ev.timestamp.getTime()) / 60_000);
                return `pending re-entry cooldown ${cooldownMin}m after cancel (${ago}m ago)`;
            }
        }
        catch {
            return `pending re-entry cooldown ${cooldownMin}m after cancel`;
        }
    }
    return null;
}
/**
 * Anti-chase: block either-side entry soon after a close (longer after a loss).
 */
async function assertSameSidePostCloseCooldown(symbol, _side, methodId = 'kim_nghia') {
    const winCd = (0, pending_order_policy_1.getPostCloseSameSideCooldownMinutes)(false);
    const lossCd = (0, pending_order_policy_1.getPostCloseSameSideCooldownMinutes)(true);
    const lookbackMin = Math.max(winCd, lossCd);
    if (!(lookbackMin > 0))
        return null;
    const since = new Date(Date.now() - lookbackMin * 60_000);
    const sym = symbol.toUpperCase().replace(/USDT$/i, '');
    const recent = await prisma_1.prisma.testnetPosition.findFirst({
        where: {
            symbol: sym,
            status: 'closed',
            close_time: { gte: since },
            account: { method_id: methodId },
        },
        orderBy: { close_time: 'desc' },
        select: { close_time: true, realized_pnl: true, position_id: true, side: true },
    });
    if (!recent?.close_time)
        return null;
    const wasLoss = (recent.realized_pnl ?? 0) < -0.01;
    const cooldownMin = (0, pending_order_policy_1.getPostCloseSameSideCooldownMinutes)(wasLoss);
    if (!(cooldownMin > 0))
        return null;
    const elapsedMin = (Date.now() - recent.close_time.getTime()) / 60_000;
    if (elapsedMin >= cooldownMin)
        return null;
    const left = Math.ceil(cooldownMin - elapsedMin);
    return (`post-close cooldown ${left}m after ${wasLoss ? 'loss' : 'close'} ` +
        `(${cooldownMin}m window, last ${recent.side})`);
}
async function canRunLlmDispatchForSymbol(symbol, methodId = 'kim_nghia') {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { symbol_method_id: { symbol: symbol.toUpperCase(), method_id: methodId } },
    });
    if (account) {
        const guard = await (0, account_risk_guard_service_1.assertTestnetAccountCanOpenTrade)(account.id, symbol);
        if (!guard.allowed) {
            return { allowed: false, reason: guard.reason };
        }
    }
    // This legacy-named guard blocks either side. Check before the scheduler
    // consumes a durable retest claim or pays for an LLM review; execution still
    // rechecks it to cover a position closing between admission and submission.
    const postCloseCooldown = await assertSameSidePostCloseCooldown(symbol, 'long', methodId);
    if (postCloseCooldown) {
        return { allowed: false, reason: postCloseCooldown };
    }
    const blockingPending = await (0, testnet_repository_1.getBlockingTestnetPendingOrders)({ symbol, methodId });
    const unresolved = blockingPending.filter((o) => o.status === 'reconciliation_failed_not_on_binance');
    if (unresolved.length > 0) {
        return {
            allowed: false,
            reason: `blocking pending=${blockingPending.length} (${unresolved.length} unresolved reconcile)`,
        };
    }
    if (blockingPending.length > 0 && !(0, v3_entry_policy_1.isV3ScaleInEnabled)()) {
        return {
            allowed: false,
            reason: `blocking pending=${blockingPending.length}`,
        };
    }
    const cancelCooldown = await hasRecentPendingCancelCooldown(symbol);
    if (cancelCooldown) {
        return { allowed: false, reason: cancelCooldown };
    }
    const exposure = await getSymbolExposureSnapshot(symbol, methodId);
    if (exposure.totalUsd >= exposure.maxExposureUsd) {
        return {
            allowed: false,
            reason: `max exposure reached (${exposure.totalUsd.toFixed(0)}/${exposure.maxExposureUsd.toFixed(0)} USD)`,
        };
    }
    if (!(0, v3_entry_policy_1.isV3ScaleInEnabled)()) {
        const openCount = exposure.openSides.length > 0 ? 1 : 0;
        if (openCount > 0) {
            return { allowed: false, reason: `open=${openCount} (scale-in disabled)` };
        }
        if (blockingPending.length > 0) {
            return { allowed: false, reason: `blocking pending=${blockingPending.length}` };
        }
        return { allowed: true, reason: 'ok' };
    }
    const sides = new Set([...exposure.openSides, ...exposure.pendingSides]);
    if (sides.has('long') && sides.has('short')) {
        return { allowed: false, reason: 'mixed long+short exposure (scale-in blocked)' };
    }
    if (exposure.remainingUsd <= 0) {
        return {
            allowed: false,
            reason: `no remaining exposure room (${exposure.totalUsd.toFixed(0)}/${exposure.maxExposureUsd.toFixed(0)} USD)`,
        };
    }
    const minNotional = (0, v3_entry_policy_1.getBinanceMinOrderNotionalUsd)();
    const minFloor = (0, v3_entry_policy_1.minNotionalWithTolerance)(minNotional, (0, v3_entry_policy_1.getNotionalTolerancePercent)());
    if (exposure.openUsd > 0 && exposure.remainingUsd < minFloor) {
        return {
            allowed: false,
            reason: `scale-in headroom $${exposure.remainingUsd.toFixed(0)} below Binance min order $${minNotional}`,
        };
    }
    return {
        allowed: true,
        reason: `scale-in ok (${exposure.totalUsd.toFixed(0)}/${exposure.maxExposureUsd.toFixed(0)} USD, room ~${exposure.remainingUsd.toFixed(0)})`,
    };
}
async function assertScaleInSideAllowed(symbol, side) {
    if (!(0, v3_entry_policy_1.isV3ScaleInEnabled)()) {
        try {
            const onExchange = await (0, binance_exposure_service_1.hasBinanceExposureForSide)(symbol, side);
            if (onExchange) {
                return `Binance already has ${side} exposure for ${symbol} (scaling-in disabled)`;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[V3Entry] Binance exposure check failed: ${message}`);
        }
        return null;
    }
    const opposite = oppositeLocalSide(side);
    try {
        const oppositeOnExchange = await (0, binance_exposure_service_1.hasBinanceExposureForSide)(symbol, opposite);
        if (oppositeOnExchange) {
            return `Cannot open ${side}: Binance already has opposite ${opposite} exposure`;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[V3Entry] Binance opposite-side check failed: ${message}`);
    }
    return null;
}
//# sourceMappingURL=v3-entry-eligibility.service.js.map