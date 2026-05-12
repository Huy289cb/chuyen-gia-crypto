/**
 * Binance Futures WebSocket User Data Stream Service
 * 
 * Handles real-time synchronization from Binance Futures User Data Stream
 * Processes ORDER_TRADE_UPDATE and ACCOUNT_UPDATE events
 */

import WebSocket from 'ws';
import { startListenKey, keepAliveListenKey, closeListenKey } from './binance/stream';
import { getTestnetPendingOrders, updateTestnetPendingOrder, createTestnetPosition, executeTestnetPendingOrder, recordTestnetTradeEvent, updateTestnetPosition } from '../repositories/testnet.repository';
import { placeStopLossOrder, placeTakeProfitOrder } from './binanceClient';
import { OrderIntent } from './binance-hedge-mode';

let ws: WebSocket | null = null;
let listenKey: string | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isRunning = false;

const WS_BASE_URL = process.env.BINANCE_TESTNET_WS_URL || 'wss://stream.binancefuture.com/ws';

/**
 * Initialize and start the Binance WebSocket User Data Stream
 */
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
  } catch (error: any) {
    console.error('[BinanceWebSocketSync] Failed to start:', error.message);
    isRunning = false;
    throw error;
  }
}

/**
 * Connect to Binance WebSocket with listen key
 */
async function connectWebSocket(): Promise<void> {
  try {
    // Create new listen key
    listenKey = await startListenKey();
    console.log('[BinanceWebSocketSync] Listen key created:', listenKey);

    // Connect to WebSocket
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

  } catch (error: any) {
    console.error('[BinanceWebSocketSync] Failed to connect WebSocket:', error.message);
    throw error;
  }
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(data: string): void {
  try {
    const message = JSON.parse(data);

    if (message.e === 'ORDER_TRADE_UPDATE') {
      handleOrderTradeUpdate(message);
    } else if (message.e === 'ACCOUNT_UPDATE') {
      handleAccountUpdate(message);
    } else {
      console.log('[BinanceWebSocketSync] Unhandled event type:', message.e);
    }
  } catch (error: any) {
    console.error('[BinanceWebSocketSync] Failed to parse message:', error.message);
  }
}

/**
 * Handle ORDER_TRADE_UPDATE event
 */
async function handleOrderTradeUpdate(event: any): Promise<void> {
  const { o: order, E: eventTime } = event;
  const binanceOrderId = String(order.i);
  const orderStatus = order.X;
  const symbol = order.s;
  const executedQty = parseFloat(order.z);
  const cumulativeQuoteQty = parseFloat(order.Z);
  const avgPrice = executedQty > 0 ? cumulativeQuoteQty / executedQty : 0;
  const orderType = order.o; // LIMIT, MARKET, STOP_MARKET, TAKE_PROFIT_MARKET

  console.log(`[BinanceWebSocketSync] ORDER_TRADE_UPDATE: binanceOrderId=${binanceOrderId} status=${orderStatus} executedQty=${executedQty}`);

  // Find local pending order by binanceOrderId
  const pendingOrders = await getTestnetPendingOrders({ symbol: symbol.replace('USDT', '') });
  const localOrder = pendingOrders.find(o => o.binance_order_id === binanceOrderId);

  if (!localOrder && orderType === 'LIMIT') {
    console.log(`[BinanceWebSocketSync] No local order found for binanceOrderId=${binanceOrderId}, skipping`);
    return;
  }

  // Handle different order statuses
  switch (orderStatus) {
    case 'NEW':
      // Order placed successfully on Binance
      console.log(`[BinanceWebSocketSync] Order NEW: ${binanceOrderId}`);
      break;

    case 'PARTIALLY_FILLED':
      // Handle partial fill
      await handlePartialFill(localOrder, executedQty, avgPrice, eventTime);
      break;

    case 'FILLED':
      // Handle full fill
      if (orderType === 'LIMIT') {
        await handleOrderFilled(localOrder, executedQty, avgPrice, eventTime);
      } else if (orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET') {
        await handleAlgoOrderFilled(binanceOrderId, orderType, executedQty, avgPrice, eventTime);
      }
      break;

    case 'CANCELED':
      // Handle order cancellation
      if (localOrder) {
        await updateTestnetPendingOrder(localOrder.order_id, {
          status: 'cancelled',
        });
        console.log(`[BinanceWebSocketSync] Local order cancelled: ${localOrder.order_id}`);
      }
      break;

    case 'EXPIRED':
    case 'REJECTED':
      // Handle failed order
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

/**
 * Handle partial fill of an order
 */
async function handlePartialFill(
  localOrder: any,
  executedQty: number,
  avgPrice: number,
  eventTime: number
): Promise<void> {
  if (!localOrder) return;

  console.log(`[BinanceWebSocketSync] Partial fill: order=${localOrder.order_id} executedQty=${executedQty} avgPrice=${avgPrice}`);

  // Update local order with partial fill info
  await updateTestnetPendingOrder(localOrder.order_id, {
    status: 'partially_filled',
    executed_quantity: executedQty,
    average_price: avgPrice,
  });

  // For partial fills, we could create a partial position
  // This is a simplified implementation - full implementation would track partial positions
  await recordTestnetTradeEvent(localOrder.order_id, 'partial_fill', {
    executed_qty: executedQty,
    avg_price: avgPrice,
    timestamp: new Date(eventTime).toISOString(),
  });
}

/**
 * Handle full fill of a LIMIT order (entry order)
 */
async function handleOrderFilled(
  localOrder: any,
  executedQty: number,
  avgPrice: number,
  eventTime: number
): Promise<void> {
  if (!localOrder) return;

  console.log(`[BinanceWebSocketSync] Order filled: order=${localOrder.order_id} executedQty=${executedQty} avgPrice=${avgPrice}`);

  const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Create local position
  await createTestnetPosition({
    positionId,
    accountId: localOrder.account_id,
    symbol: localOrder.symbol,
    side: localOrder.side,
    entryPrice: avgPrice,
    stopLoss: localOrder.stop_loss,
    takeProfit: localOrder.take_profit,
    sizeUsd: executedQty * avgPrice,
    sizeQty: executedQty,
    riskUsd: localOrder.risk_usd,
    riskPercent: localOrder.risk_percent,
    expectedRr: localOrder.expected_rr,
    linkedPredictionId: localOrder.linked_prediction_id ?? undefined,
    binanceOrderId: localOrder.binance_order_id,
    binanceSlOrderId: undefined,
    binanceTpOrderId: undefined,
    tpLevels: undefined,
    tpHitCount: 0,
    partialClosed: 0,
    entryFee: 0,
  });

  // Mark local pending order as executed
  await executeTestnetPendingOrder(localOrder.order_id, positionId);

  await recordTestnetTradeEvent(positionId, 'entry_order_filled', {
    order_id: localOrder.order_id,
    binance_order_id: localOrder.binance_order_id,
    executed_qty: executedQty,
    avg_price: avgPrice,
    timestamp: new Date(eventTime).toISOString(),
  });

  // Place SL/TP orders on Binance
  await placeStopLossAndTakeProfitOrders(positionId, localOrder, executedQty);

  console.log(`[BinanceWebSocketSync] Position created and SL/TP orders placed: ${positionId}`);
}

/**
 * Handle fill of an algo order (STOP_MARKET or TAKE_PROFIT_MARKET)
 */
async function handleAlgoOrderFilled(
  binanceOrderId: string,
  orderType: string,
  executedQty: number,
  avgPrice: number,
  eventTime: number
): Promise<void> {
  console.log(`[BinanceWebSocketSync] Algo order filled: binanceOrderId=${binanceOrderId} type=${orderType}`);

  // Find the position associated with this algo order
  // This requires querying positions by binance_sl_order_id or binance_tp_order_id
  // For now, we'll log this - full implementation would close the position
  await recordTestnetTradeEvent('unknown', 'algo_order_filled', {
    binance_order_id: binanceOrderId,
    order_type: orderType,
    executed_qty: executedQty,
    avg_price: avgPrice,
    timestamp: new Date(eventTime).toISOString(),
  });
}

/**
 * Place stop loss and take profit orders on Binance after entry fill
 */
async function placeStopLossAndTakeProfitOrders(
  positionId: string,
  localOrder: any,
  executedQty: number
): Promise<void> {
  try {
    const client = { }; // Binance client is not needed for module functions

    const side = localOrder.side === 'long' ? 'SELL' : 'BUY';
    const positionSide = localOrder.side === 'long' ? 'LONG' : 'SHORT';

    // Construct current position info for CLOSE intent
    const currentPosition = {
      positionAmt: localOrder.side === 'long' ? executedQty : -executedQty,
      positionSide: positionSide,
    };

    // Place Stop Loss order
    const slOrder = await placeStopLossOrder(
      client,
      'BTCUSDT',
      side,
      executedQty,
      localOrder.stop_loss,
      'CLOSE', // Closing position
      currentPosition,
      null // Let resolvePositionSide determine positionSide
    );

    // Place Take Profit order
    const tpOrder = await placeTakeProfitOrder(
      client,
      'BTCUSDT',
      side,
      executedQty,
      localOrder.take_profit,
      'CLOSE', // Closing position
      currentPosition,
      null // Let resolvePositionSide determine positionSide
    );

    // Update position with Binance SL/TP order IDs
    await updateTestnetPosition(positionId, {
      binance_sl_order_id: String(slOrder.orderId),
      binance_tp_order_id: String(tpOrder.orderId),
    });

    console.log(`[BinanceWebSocketSync] SL/TP orders placed and saved: SL=${slOrder.orderId} TP=${tpOrder.orderId} for position ${positionId}`);

  } catch (error: any) {
    console.error('[BinanceWebSocketSync] Failed to place SL/TP orders:', error.message);
    // Don't throw - position is already created, SL/TP can be placed manually
  }
}

/**
 * Handle ACCOUNT_UPDATE event
 */
function handleAccountUpdate(event: any): void {
  const { E: eventTime } = event;
  
  console.log(`[BinanceWebSocketSync] ACCOUNT_UPDATE at ${new Date(eventTime).toISOString()}`);
  
  // Account updates contain balance and position information
  // This can be used to sync account state
  // For now, we'll log this - full implementation would sync account balance
}

/**
 * Start keep-alive interval for listen key
 */
function startKeepAlive(): void {
  // Keep alive every 30 minutes (Binance recommends every 30 minutes)
  keepAliveInterval = setInterval(async () => {
    if (listenKey) {
      try {
        await keepAliveListenKey(listenKey);
        console.log('[BinanceWebSocketSync] Listen key kept alive');
      } catch (error: any) {
        console.error('[BinanceWebSocketSync] Failed to keep alive listen key:', error.message);
      }
    }
  }, 30 * 60 * 1000); // 30 minutes
}

/**
 * Handle WebSocket reconnection
 */
function handleReconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  reconnectTimeout = setTimeout(async () => {
    console.log('[BinanceWebSocketSync] Attempting to reconnect...');
    try {
      if (ws) {
        ws.close();
      }
      await connectWebSocket();
    } catch (error: any) {
      console.error('[BinanceWebSocketSync] Reconnect failed, retrying in 5 seconds:', error.message);
      handleReconnect();
    }
  }, 5000); // Retry after 5 seconds
}

/**
 * Stop the Binance WebSocket User Data Stream
 */
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
    } catch (error: any) {
      console.error('[BinanceWebSocketSync] Failed to close listen key:', error.message);
    }
    listenKey = null;
  }

  // Stop periodic reconciliation
  const { stopPeriodicReconciliation } = await import('./binance-reconciliation');
  stopPeriodicReconciliation();

  console.log('[BinanceWebSocketSync] Stopped');
}
