/**
 * Binance Futures WebSocket User Data Stream Service
 *
 * Handles real-time synchronization from Binance Futures User Data Stream
 * Processes ORDER_TRADE_UPDATE and ACCOUNT_UPDATE events
 */

import WebSocket from 'ws';
import { startListenKey, keepAliveListenKey, closeListenKey } from './binance/stream';
import {
  updateTestnetPendingOrder,
  recordTestnetTradeEvent,
} from '../repositories/testnet.repository';
import {
  findLocalOrderForBinanceEvent,
  materializePositionFromPendingFill,
  resolveFillAvgPrice,
  resolveFillQty,
} from './binance-order-fill.service';
import {
  closeOpenPositionFromBinanceFill,
  syncClosedPositionsFromAccountUpdate,
} from './position-close.service';

let ws: WebSocket | null = null;
let listenKey: string | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isRunning = false;

const WS_BASE_URL = process.env.BINANCE_TESTNET_WS_URL || 'wss://stream.binancefuture.com/ws';

export async function startBinanceWebSocketSync(): Promise<void> {
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[BinanceWebSocketSync] Failed to start:', message);
    isRunning = false;
    throw error;
  }
}

async function connectWebSocket(): Promise<void> {
  listenKey = await startListenKey();
  console.log('[BinanceWebSocketSync] Listen key created:', listenKey);

  const wsUrl = `${WS_BASE_URL}/${listenKey}`;
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[BinanceWebSocketSync] WebSocket connected');
  });

  ws.on('message', (data: WebSocket.Data) => {
    handleMessage(data.toString());
  });

  ws.on('error', (error: Error) => {
    console.error('[BinanceWebSocketSync] WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('[BinanceWebSocketSync] WebSocket closed, attempting reconnect...');
    handleReconnect();
  });
}

function handleMessage(data: string): void {
  try {
    const message = JSON.parse(data);

    if (message.e === 'ORDER_TRADE_UPDATE') {
      void handleOrderTradeUpdate(message);
    } else if (message.e === 'ACCOUNT_UPDATE') {
      handleAccountUpdate(message);
    } else {
      console.log('[BinanceWebSocketSync] Unhandled event type:', message.e);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[BinanceWebSocketSync] Failed to parse message:', message);
  }
}

async function handleOrderTradeUpdate(event: any): Promise<void> {
  const { o: order, E: eventTime } = event;
  const binanceOrderId = String(order.i);
  const orderStatus = order.X;
  const symbol = order.s;
  const executedQty = resolveFillQty(order, parseFloat(order.z));
  const avgPrice = resolveFillAvgPrice(order, executedQty);
  const orderType = order.o;

  console.log(
    `[BinanceWebSocketSync] ORDER_TRADE_UPDATE: binanceOrderId=${binanceOrderId} status=${orderStatus} executedQty=${executedQty} avgPrice=${avgPrice}`
  );

  const localOrder = await findLocalOrderForBinanceEvent(binanceOrderId, symbol);
  const isAlgoClose =
    orderType === 'STOP_MARKET' ||
    orderType === 'TAKE_PROFIT_MARKET' ||
    orderType === 'STOP' ||
    orderType === 'TAKE_PROFIT';

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
      } else if (isAlgoClose) {
        await handleAlgoOrderFilled(
          binanceOrderId,
          orderType,
          executedQty,
          avgPrice,
          symbol,
          eventTime
        );
      }
      break;

    case 'CANCELED':
      if (localOrder) {
        await updateTestnetPendingOrder(localOrder.order_id, { status: 'cancelled' });
        console.log(`[BinanceWebSocketSync] Local order cancelled: ${localOrder.order_id}`);
      }
      break;

    case 'EXPIRED':
    case 'REJECTED':
      if (localOrder) {
        await updateTestnetPendingOrder(localOrder.order_id, {
          status: orderStatus.toLowerCase(),
        });
        console.log(`[BinanceWebSocketSync] Local order ${orderStatus.toLowerCase()}: ${localOrder.order_id}`);
      }
      break;

    default:
      console.log(`[BinanceWebSocketSync] Unhandled order status: ${orderStatus}`);
  }
}

async function handlePartialFill(
  localOrder: any,
  executedQty: number,
  avgPrice: number,
  eventTime: number
): Promise<void> {
  if (!localOrder) return;

  const price =
    avgPrice > 0 ? avgPrice : Number(localOrder.entry_price) || 0;

  console.log(
    `[BinanceWebSocketSync] Partial fill: order=${localOrder.order_id} executedQty=${executedQty} avgPrice=${price}`
  );

  await updateTestnetPendingOrder(localOrder.order_id, {
    status: 'partially_filled',
    executed_quantity: executedQty,
    average_price: price,
  });

  await recordTestnetTradeEvent(localOrder.order_id, 'partial_fill', {
    executed_qty: executedQty,
    avg_price: price,
    timestamp: new Date(eventTime).toISOString(),
  });
}

async function handleOrderFilled(
  localOrder: any,
  order: any,
  executedQty: number,
  eventTime: number
): Promise<void> {
  if (!localOrder) return;

  const avgPrice = resolveFillAvgPrice(order, executedQty, Number(localOrder.entry_price));
  const qty = executedQty > 0 ? executedQty : resolveFillQty(order, 0);

  console.log(
    `[BinanceWebSocketSync] Order filled: order=${localOrder.order_id} executedQty=${qty} avgPrice=${avgPrice}`
  );

  if (avgPrice <= 0 || qty <= 0) {
    console.error(
      `[BinanceWebSocketSync] Cannot materialize position for ${localOrder.order_id}: invalid qty/price`
    );
    return;
  }

  await materializePositionFromPendingFill(localOrder, qty, avgPrice, eventTime);
}

async function handleAlgoOrderFilled(
  binanceOrderId: string,
  orderType: string,
  executedQty: number,
  avgPrice: number,
  symbol: string,
  eventTime: number
): Promise<void> {
  console.log(`[BinanceWebSocketSync] Algo order filled: binanceOrderId=${binanceOrderId} type=${orderType}`);

  const closed = await closeOpenPositionFromBinanceFill(
    binanceOrderId,
    orderType,
    executedQty,
    avgPrice,
    symbol
  );

  await recordTestnetTradeEvent('unknown', closed ? 'position_closed_algo' : 'algo_order_filled', {
    binance_order_id: binanceOrderId,
    order_type: orderType,
    executed_qty: executedQty,
    avg_price: avgPrice,
    position_closed: closed,
    timestamp: new Date(eventTime).toISOString(),
  });
}

function handleAccountUpdate(event: any): void {
  const { E: eventTime, a: account } = event;
  console.log(`[BinanceWebSocketSync] ACCOUNT_UPDATE at ${new Date(eventTime).toISOString()}`);
  void syncClosedPositionsFromAccountUpdate(account?.P ?? []);
}

function startKeepAlive(): void {
  keepAliveInterval = setInterval(async () => {
    if (listenKey) {
      try {
        await keepAliveListenKey(listenKey);
        console.log('[BinanceWebSocketSync] Listen key kept alive');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[BinanceWebSocketSync] Failed to keep alive listen key:', message);
      }
    }
  }, 30 * 60 * 1000);
}

function handleReconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  reconnectTimeout = setTimeout(async () => {
    console.log('[BinanceWebSocketSync] Attempting to reconnect...');
    try {
      await connectWebSocket();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BinanceWebSocketSync] Reconnect failed, retrying in 5 seconds:', message);
      handleReconnect();
    }
  }, 5000);
}

export async function stopBinanceWebSocketSync(): Promise<void> {
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
      await closeListenKey(listenKey);
      console.log('[BinanceWebSocketSync] Listen key closed');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[BinanceWebSocketSync] Failed to close listen key:', message);
    }
    listenKey = null;
  }

  console.log('[BinanceWebSocketSync] Stopped');
}
