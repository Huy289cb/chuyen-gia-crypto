"use strict";
/**
 * Expire stale limit pending orders (TTL + price drift) and free pipeline capacity.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPendingOrderLifecycle = runPendingOrderLifecycle;
const prisma_1 = require("../lib/prisma");
const market_repository_1 = require("../repositories/market.repository");
const pending_order_policy_1 = require("../config/pending-order-policy");
const pending_order_actions_1 = require("./pending-order-actions");
function entryDriftExceeded(entryPrice, markPrice, maxDriftPct) {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) {
        return false;
    }
    return Math.abs(markPrice - entryPrice) / entryPrice >= maxDriftPct;
}
/**
 * Review all pending limit orders: cancel on TTL or adverse price drift.
 */
async function runPendingOrderLifecycle(symbol = 'BTC') {
    const result = { reviewed: 0, cancelled: 0, reasons: [] };
    if (!(0, pending_order_policy_1.isPendingOrderLifecycleEnabled)()) {
        return result;
    }
    const pending = await prisma_1.prisma.testnetPendingOrder.findMany({
        where: { symbol: symbol.toUpperCase(), status: 'pending' },
        orderBy: { created_at: 'asc' },
    });
    if (pending.length === 0)
        return result;
    const latest = await (0, market_repository_1.getLatestPrice)(symbol);
    const markPrice = latest?.price ?? 0;
    const maxDriftPct = (0, pending_order_policy_1.getPendingOrderMaxDriftPct)();
    const now = Date.now();
    for (const order of pending) {
        result.reviewed += 1;
        const ageHours = (now - new Date(order.created_at).getTime()) / (3600 * 1000);
        const timeframe = await (0, pending_order_actions_1.resolveTimeframeForPendingOrder)(order.order_id);
        const ttlHours = (0, pending_order_policy_1.getPendingOrderTtlHours)(timeframe);
        if (ageHours >= ttlHours) {
            await (0, pending_order_actions_1.cancelPendingOnExchangeAndDb)(order, 'ttl_expired');
            result.cancelled += 1;
            result.reasons.push({ order_id: order.order_id, reason: 'ttl_expired' });
            const ageLabel = ageHours < 2 ? `${Math.round(ageHours * 60)}m` : `${ageHours.toFixed(1)}h`;
            const ttlLabel = ttlHours < 2 ? `${Math.round(ttlHours * 60)}m` : `${ttlHours.toFixed(1)}h`;
            console.log(`[PendingLifecycle] TTL cancel ${order.order_id} age=${ageLabel} ttl=${ttlLabel} tf=${timeframe ?? 'default'}`);
            continue;
        }
        if (markPrice > 0 && entryDriftExceeded(order.entry_price, markPrice, maxDriftPct)) {
            await (0, pending_order_actions_1.cancelPendingOnExchangeAndDb)(order, 'price_drift');
            result.cancelled += 1;
            result.reasons.push({ order_id: order.order_id, reason: 'price_drift' });
            console.log(`[PendingLifecycle] Drift cancel ${order.order_id} entry=${order.entry_price} mark=${markPrice} maxDrift=${(maxDriftPct * 100).toFixed(2)}%`);
        }
    }
    return result;
}
//# sourceMappingURL=pending-order-lifecycle.service.js.map