"use strict";
/**
 * Binance Futures WebSocket User Data Stream Service
 *
 * Handles real-time synchronization from Binance Futures User Data Stream
 * Processes ORDER_TRADE_UPDATE and ACCOUNT_UPDATE events
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBinanceWebSocketSync = startBinanceWebSocketSync;
exports.handleOrderTradeUpdate = handleOrderTradeUpdate;
exports.stopBinanceWebSocketSync = stopBinanceWebSocketSync;
const ws_1 = __importDefault(require("ws"));
const stream_1 = require("./binance/stream");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_order_fill_service_1 = require("./binance-order-fill.service");
const position_close_service_1 = require("./position-close.service");
const telegram_hooks_1 = require("./telegram/telegram-hooks");
const pending_order_actions_1 = require("./pending-order-actions");
let ws = null;
let listenKey = null;
let keepAliveInterval = null;
let reconnectTimeout = null;
let isRunning = false;
const WS_BASE_URL = process.env.BINANCE_TESTNET_WS_URL || 'wss://stream.binancefuture.com/ws';
async function startBinanceWebSocketSync() {
    if (isRunning) {
        console.log('[BinanceWebSocketSync] Already running');
        return;
    }
    if (process.env.BINANCE_ENABLED !== 'true') {
        console.log('[BinanceWebSocketSync] BINANCE_ENABLED is not true, skipping');
        return;
    }
    try {
        isRunning = true;
        await connectWebSocket();
        startKeepAlive();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[BinanceWebSocketSync] Failed to start:', message);
        isRunning = false;
        throw error;
    }
}
async function connectWebSocket() {
    listenKey = await (0, stream_1.startListenKey)();
    console.log('[BinanceWebSocketSync] Listen key created');
    const wsUrl = `${WS_BASE_URL}/${listenKey}`;
    ws = new ws_1.default(wsUrl);
    ws.on('open', () => {
        console.log('[BinanceWebSocketSync] WebSocket connected');
    });
    ws.on('message', (data) => {
        handleMessage(data.toString());
    });
    ws.on('error', (error) => {
        console.error('[BinanceWebSocketSync] WebSocket error:', error.message);
    });
    ws.on('close', () => {
        console.log('[BinanceWebSocketSync] WebSocket closed, attempting reconnect...');
        handleReconnect();
    });
}
function handleMessage(data) {
    try {
        const message = JSON.parse(data);
        if (message.e === 'ORDER_TRADE_UPDATE') {
            void handleOrderTradeUpdate(message).catch((error) => {
                const msg = error instanceof Error ? error.message : String(error);
                console.error('[BinanceWebSocketSync] ORDER_TRADE_UPDATE handler failed:', msg);
            });
        }
        else if (message.e === 'ACCOUNT_UPDATE') {
            handleAccountUpdate(message);
        }
        else {
            console.log('[BinanceWebSocketSync] Unhandled event type:', message.e);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[BinanceWebSocketSync] Failed to parse message:', message);
    }
}
async function handleOrderTradeUpdate(event) {
    const { o: order, E: eventTime } = event;
    const binanceOrderId = String(order.i);
    const orderStatus = order.X;
    const symbol = order.s;
    const executedQty = (0, binance_order_fill_service_1.resolveFillQty)(order, parseFloat(order.z));
    const avgPrice = (0, binance_order_fill_service_1.resolveFillAvgPrice)(order, executedQty);
    const orderType = order.o;
    console.log(`[BinanceWebSocketSync] ORDER_TRADE_UPDATE: binanceOrderId=${binanceOrderId} status=${orderStatus} executedQty=${executedQty} avgPrice=${avgPrice}`);
    const clientOrderId = typeof order.c === 'string' ? order.c : undefined;
    let localOrder = await (0, binance_order_fill_service_1.findLocalOrderForBinanceEvent)(binanceOrderId, symbol, clientOrderId);
    const isAlgoClose = orderType === 'STOP_MARKET' ||
        orderType === 'TAKE_PROFIT_MARKET' ||
        orderType === 'STOP' ||
        orderType === 'TAKE_PROFIT';
    if (!localOrder && orderType === 'LIMIT' && orderStatus === 'FILLED') {
        console.warn(`[BinanceWebSocketSync] FILLED without local row binanceOrderId=${binanceOrderId} clientOrderId=${clientOrderId ?? 'n/a'} — reconciliation will recover`);
        return;
    }
    if (!localOrder && orderType === 'LIMIT') {
        console.log(`[BinanceWebSocketSync] No local order found for binanceOrderId=${binanceOrderId}, skipping`);
        return;
    }
    switch (orderStatus) {
        case 'NEW':
            console.log(`[BinanceWebSocketSync] Order NEW: ${binanceOrderId}`);
            break;
        case 'PARTIALLY_FILLED':
            await handlePartialFill(localOrder, executedQty, avgPrice, eventTime);
            break;
        case 'FILLED':
            if (orderType === 'LIMIT' && localOrder) {
                await handleOrderFilled(localOrder, order, executedQty, eventTime);
            }
            else if (isAlgoClose) {
                await handleAlgoOrderFilled(binanceOrderId, orderType, executedQty, avgPrice, symbol, eventTime);
            }
            break;
        case 'CANCELED':
            if (localOrder) {
                if ((0, pending_order_actions_1.isPendingOrderTerminal)(localOrder.status)) {
                    break;
                }
                const { prisma: db } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
                const claimed = await db.testnetPendingOrder.updateMany({
                    where: {
                        order_id: localOrder.order_id,
                        status: { in: ['pending', 'partially_filled'] },
                    },
                    data: { status: 'cancelled' },
                });
                if (claimed.count === 0) {
                    break;
                }
                console.log(`[BinanceWebSocketSync] Local order cancelled: ${localOrder.order_id}`);
                (0, telegram_hooks_1.hookPendingCancelled)(localOrder.symbol, localOrder.order_id, 'binance_canceled');
            }
            break;
        case 'EXPIRED':
        case 'REJECTED':
            if (localOrder) {
                await (0, testnet_repository_1.updateTestnetPendingOrder)(localOrder.order_id, {
                    status: orderStatus.toLowerCase(),
                });
                console.log(`[BinanceWebSocketSync] Local order ${orderStatus.toLowerCase()}: ${localOrder.order_id}`);
            }
            break;
        default:
            console.log(`[BinanceWebSocketSync] Unhandled order status: ${orderStatus}`);
    }
}
async function handlePartialFill(localOrder, executedQty, avgPrice, eventTime) {
    if (!localOrder)
        return;
    const price = avgPrice > 0 ? avgPrice : Number(localOrder.entry_price) || 0;
    console.log(`[BinanceWebSocketSync] Partial fill: order=${localOrder.order_id} executedQty=${executedQty} avgPrice=${price}`);
    await (0, testnet_repository_1.updateTestnetPendingOrder)(localOrder.order_id, {
        status: 'partially_filled',
        executed_size_qty: executedQty,
        executed_size_usd: executedQty * price,
        executed_price: price,
        executed_at: new Date(eventTime),
    });
    await (0, testnet_repository_1.recordPipelineEvent)('partial_fill', {
        order_id: localOrder.order_id,
        binance_order_id: localOrder.binance_order_id ?? null,
        symbol: localOrder.symbol,
        executed_qty: executedQty,
        avg_price: price,
        suppress_telegram: true,
        timestamp: new Date(eventTime).toISOString(),
    });
}
async function handleOrderFilled(localOrder, order, executedQty, eventTime) {
    if (!localOrder)
        return;
    const avgPrice = (0, binance_order_fill_service_1.resolveFillAvgPrice)(order, executedQty, Number(localOrder.entry_price));
    const qty = executedQty > 0 ? executedQty : (0, binance_order_fill_service_1.resolveFillQty)(order, 0);
    console.log(`[BinanceWebSocketSync] Order filled: order=${localOrder.order_id} executedQty=${qty} avgPrice=${avgPrice}`);
    if (avgPrice <= 0 || qty <= 0) {
        console.error(`[BinanceWebSocketSync] Cannot materialize position for ${localOrder.order_id}: invalid qty/price`);
        return;
    }
    await (0, binance_order_fill_service_1.materializePositionFromPendingFill)(localOrder, qty, avgPrice, eventTime);
}
async function handleAlgoOrderFilled(binanceOrderId, orderType, executedQty, avgPrice, symbol, eventTime) {
    console.log(`[BinanceWebSocketSync] Algo order filled: binanceOrderId=${binanceOrderId} type=${orderType}`);
    const closed = await (0, position_close_service_1.closeOpenPositionFromBinanceFill)(binanceOrderId, orderType, executedQty, avgPrice, symbol);
    if (!closed) {
        await (0, testnet_repository_1.recordPipelineEvent)('algo_order_filled', {
            binance_order_id: binanceOrderId,
            order_type: orderType,
            symbol,
            executed_qty: executedQty,
            avg_price: avgPrice,
            position_closed: false,
            timestamp: new Date(eventTime).toISOString(),
        });
    }
}
function handleAccountUpdate(event) {
    const { E: eventTime, a: account } = event;
    console.log(`[BinanceWebSocketSync] ACCOUNT_UPDATE at ${new Date(eventTime).toISOString()}`);
    void (0, position_close_service_1.syncClosedPositionsFromAccountUpdate)(account?.P ?? []).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[BinanceWebSocketSync] ACCOUNT_UPDATE handler failed:', msg);
    });
}
function startKeepAlive() {
    keepAliveInterval = setInterval(async () => {
        if (listenKey) {
            try {
                await (0, stream_1.keepAliveListenKey)(listenKey);
                console.log('[BinanceWebSocketSync] Listen key kept alive');
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error('[BinanceWebSocketSync] Failed to keep alive listen key:', message);
            }
        }
    }, 30 * 60 * 1000);
}
function handleReconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    reconnectTimeout = setTimeout(async () => {
        console.log('[BinanceWebSocketSync] Attempting to reconnect...');
        try {
            await connectWebSocket();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[BinanceWebSocketSync] Reconnect failed, retrying in 5 seconds:', message);
            handleReconnect();
        }
    }, 5000);
}
async function stopBinanceWebSocketSync() {
    isRunning = false;
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    if (listenKey) {
        try {
            await (0, stream_1.closeListenKey)(listenKey);
            console.log('[BinanceWebSocketSync] Listen key closed');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[BinanceWebSocketSync] Failed to close listen key:', message);
        }
        listenKey = null;
    }
    console.log('[BinanceWebSocketSync] Stopped');
}
//# sourceMappingURL=binance-websocket-sync.js.map