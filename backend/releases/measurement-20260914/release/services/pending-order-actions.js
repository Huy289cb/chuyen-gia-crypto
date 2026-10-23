"use strict";
/**
 * Shared Binance + DB actions for pending limit orders.
 */
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
exports.isPendingOrderTerminal = isPendingOrderTerminal;
exports.resolveTimeframeForPendingOrder = resolveTimeframeForPendingOrder;
exports.cancelPendingOnExchangeAndDb = cancelPendingOnExchangeAndDb;
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const telegram_hooks_1 = require("./telegram/telegram-hooks");
const PENDING_ACTIVE_STATUSES = new Set(['pending', 'partially_filled']);
function isPendingOrderTerminal(status) {
    if (!status)
        return false;
    if (PENDING_ACTIVE_STATUSES.has(status))
        return false;
    if (status === 'executed' || status === 'executed_historical')
        return true;
    if (status === 'cancelled' || status.startsWith('cancelled_'))
        return true;
    return status === 'expired' || status === 'rejected' || status === 'failed';
}
async function resolveTimeframeForPendingOrder(orderId) {
    const events = await prisma_1.prisma.testnetTradeEvent.findMany({
        where: {
            position_id: testnet_repository_1.PIPELINE_EVENT_POSITION_ID,
            event_type: 'pending_order_linked',
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
    });
    for (const ev of events) {
        if (!ev.event_data)
            continue;
        try {
            const data = JSON.parse(ev.event_data);
            if (data.order_id === orderId && typeof data.timeframe === 'string') {
                return data.timeframe;
            }
        }
        catch {
            /* ignore */
        }
    }
    return null;
}
async function cancelPendingOnExchangeAndDb(order, reason) {
    const claimed = await prisma_1.prisma.testnetPendingOrder.updateMany({
        where: {
            order_id: order.order_id,
            status: { in: [...PENDING_ACTIVE_STATUSES] },
        },
        data: { status: `cancelled_${reason}` },
    });
    if (claimed.count === 0) {
        return;
    }
    if (process.env.BINANCE_ENABLED === 'true' && order.binance_order_id) {
        try {
            const { initTestnetClient, cancelOrder } = await Promise.resolve().then(() => __importStar(require('./binanceClient')));
            const client = initTestnetClient();
            if (client) {
                await cancelOrder(client, `${order.symbol.toUpperCase()}USDT`, Number(order.binance_order_id));
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[PendingOrder] Binance cancel failed for ${order.order_id} (${order.binance_order_id}): ${msg}`);
        }
    }
    (0, telegram_hooks_1.hookPendingCancelled)(order.symbol, order.order_id, reason);
    await (0, testnet_repository_1.recordPipelineEvent)('pending_order_cancelled', {
        order_id: order.order_id,
        reason,
        symbol: order.symbol,
        binance_order_id: order.binance_order_id ?? undefined,
    });
}
//# sourceMappingURL=pending-order-actions.js.map