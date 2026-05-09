/**
 * Binance Futures Trading Module
 * 
 * Trading endpoints for Binance Futures
 */

import { post, del, get } from './client';
import { endpoints } from './endpoints';

interface OrderParams {
  symbol: string;
  side: string;
  type: string;
  quantity: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: string;
  reduceOnly?: boolean;
  positionSide?: string;
}

interface StopMarketOrderParams {
  symbol: string;
  side: string;
  quantity: string;
  stopPrice: string;
  positionSide?: string;
  closePosition?: boolean;
  reduceOnly?: boolean;
  timeInForce?: string;
}

interface TakeProfitMarketOrderParams {
  symbol: string;
  side: string;
  quantity: string;
  stopPrice: string;
  positionSide?: string;
  closePosition?: boolean;
  reduceOnly?: boolean;
  timeInForce?: string;
}

/**
 * Set leverage for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {number} leverage - Leverage multiplier (1-125)
 * @returns {Promise<object>} Response data
 */
export async function setLeverage(symbol: string, leverage: number): Promise<any> {
  try {
    const response: any = await post(endpoints.LEVERAGE, {
      symbol,
      leverage: leverage.toString(),
    }, true);
    
    console.log(`[BinanceTrading] Leverage set to ${leverage}x for ${symbol}`);
    return {
      symbol: response.symbol,
      leverage: parseInt(response.leverage),
      maxNotionalValue: parseFloat(response.maxNotionalValue),
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to set leverage:', error.message);
    throw error;
  }
}

/**
 * Set margin type for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {string} marginType - Margin type (ISOLATED or CROSSED)
 * @returns {Promise<object>} Response data
 */
export async function setMarginType(symbol: string, marginType: string): Promise<any> {
  try {
    const response: any = await post(endpoints.MARGIN_TYPE, {
      symbol,
      marginType,
    }, true);
    
    console.log(`[BinanceTrading] Margin type set to ${marginType} for ${symbol}`);
    return response;
  } catch (error: any) {
    // Ignore "No need to change margin type" error
    if (error.message.includes('No need to change margin type')) {
      console.log(`[BinanceTrading] Margin type already set to ${marginType} for ${symbol}`);
      return { symbol, marginType };
    }
    console.error('[BinanceTrading] Failed to set margin type:', error.message);
    throw error;
  }
}

/**
 * Set position mode (dual position side)
 * @param {boolean} dual - True for dual position side, false for hedge mode disabled
 * @returns {Promise<object>} Response data
 */
export async function setPositionMode(dual: boolean): Promise<any> {
  try {
    const response: any = await post(endpoints.POSITION_MODE, {
      dualSidePosition: dual.toString(),
    }, true);
    
    console.log(`[BinanceTrading] Position mode set to ${dual ? 'dual' : 'single'} side`);
    return response;
  } catch (error: any) {
    // Ignore "No need to change position side" error
    if (error.message.includes('-4059') || error.message.includes('No need to change position side')) {
      console.log(`[BinanceTrading] Position mode already set to ${dual ? 'dual' : 'single'} side`);
      return { dualSidePosition: dual.toString() };
    }
    console.error('[BinanceTrading] Failed to set position mode:', error.message);
    throw error;
  }
}

/**
 * Place a new stop-market order (for hedge mode SL/TP) using Algo Order API
 * @param {object} params - Order parameters
 * @param {string} params.symbol - Trading symbol
 * @param {string} params.side - BUY or SELL
 * @param {string} params.quantity - Order quantity
 * @param {string} params.stopPrice - Stop/trigger price
 * @param {string} [params.positionSide] - Position side (LONG, SHORT) - required for hedge mode
 * @param {boolean} [params.closePosition] - Close position flag (true to close position)
 * @param {boolean} [params.reduceOnly] - Reduce only flag
 * @param {string} [params.timeInForce] - Time in force (GTC, IOC, FOK, GTX)
 * @returns {Promise<object>} Order response
 */
export async function placeStopMarketOrder(params: StopMarketOrderParams): Promise<any> {
  try {
    const requestParams: any = {
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      triggerPrice: params.stopPrice, // Algo Order API uses triggerPrice instead of stopPrice
      positionSide: params.positionSide,
      timeInForce: params.timeInForce || 'GTC',
      algoType: 'CONDITIONAL',
      type: 'STOP_MARKET',
    };

    // Only set closePosition if it's true (for hedge mode)
    if (params.closePosition) {
      requestParams.closePosition = true;
    }

    // Only set reduceOnly if closePosition is false (for single position mode)
    if (!params.closePosition && params.reduceOnly) {
      requestParams.reduceOnly = true;
    }

    const response: any = await post(endpoints.ALGO_ORDER, requestParams, true);

    console.log(`[BinanceTrading] Stop-market algo order placed: ${params.side} ${params.quantity} ${params.symbol} @ ${params.stopPrice}${params.positionSide ? ` (positionSide: ${params.positionSide})` : ''}`);

    return {
      orderId: response.orderId || response.algoId,
      clientOrderId: response.clientOrderId || response.clientAlgoId,
      symbol: response.symbol,
      side: response.side,
      type: 'STOP_MARKET',
      price: response.price ? parseFloat(response.price) : null,
      stopPrice: response.stopPrice ? parseFloat(response.stopPrice) : null,
      origQty: parseFloat(response.origQty),
      executedQty: parseFloat(response.executedQty),
      cummulativeQuoteQty: parseFloat(response.cummulativeQuoteQty),
      status: response.status,
      timeInForce: response.timeInForce,
      transactTime: response.transactTime,
      updateTime: response.updateTime,
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to place stop-market order:', error.message);
    throw error;
  }
}

/**
 * Place a new take-profit-market order (for hedge mode SL/TP) using Algo Order API
 * @param {object} params - Order parameters
 * @param {string} params.symbol - Trading symbol
 * @param {string} params.side - BUY or SELL
 * @param {string} params.quantity - Order quantity
 * @param {string} params.stopPrice - Take profit/trigger price
 * @param {string} [params.positionSide] - Position side (LONG, SHORT) - required for hedge mode
 * @param {boolean} [params.closePosition] - Close position flag (true to close position)
 * @param {boolean} [params.reduceOnly] - Reduce only flag
 * @param {string} [params.timeInForce] - Time in force (GTC, IOC, FOK, GTX)
 * @returns {Promise<object>} Order response
 */
export async function placeTakeProfitMarketOrder(params: TakeProfitMarketOrderParams): Promise<any> {
  try {
    const requestParams: any = {
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      triggerPrice: params.stopPrice, // Algo Order API uses triggerPrice instead of stopPrice
      positionSide: params.positionSide,
      timeInForce: params.timeInForce || 'GTC',
      algoType: 'CONDITIONAL',
      type: 'TAKE_PROFIT_MARKET',
    };

    // Only set closePosition if it's true (for hedge mode)
    if (params.closePosition) {
      requestParams.closePosition = true;
    }

    // Only set reduceOnly if closePosition is false (for single position mode)
    if (!params.closePosition && params.reduceOnly) {
      requestParams.reduceOnly = true;
    }

    const response: any = await post(endpoints.ALGO_ORDER, requestParams, true);

    console.log(`[BinanceTrading] Take-profit-market algo order placed: ${params.side} ${params.quantity} ${params.symbol} @ ${params.stopPrice}${params.positionSide ? ` (positionSide: ${params.positionSide})` : ''}`);

    return {
      orderId: response.orderId || response.algoId,
      clientOrderId: response.clientOrderId || response.clientAlgoId,
      symbol: response.symbol,
      side: response.side,
      type: 'TAKE_PROFIT_MARKET',
      price: response.price ? parseFloat(response.price) : null,
      stopPrice: response.stopPrice ? parseFloat(response.stopPrice) : null,
      origQty: parseFloat(response.origQty),
      executedQty: parseFloat(response.executedQty),
      cummulativeQuoteQty: parseFloat(response.cummulativeQuoteQty),
      status: response.status,
      timeInForce: response.timeInForce,
      transactTime: response.transactTime,
      updateTime: response.updateTime,
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to place take-profit-market order:', error.message);
    throw error;
  }
}

/**
 * Place a new algo order (STOP_MARKET, TAKE_PROFIT_MARKET for hedge mode) - DEPRECATED
 * Use placeStopMarketOrder or placeTakeProfitMarket instead
 * @deprecated
 */
export async function placeAlgoOrder(params: any): Promise<any> {
  // For backward compatibility, route to the correct function based on type
  if (params.type === 'STOP_MARKET') {
    return placeStopMarketOrder(params);
  } else if (params.type === 'TAKE_PROFIT_MARKET') {
    return placeTakeProfitMarketOrder(params);
  } else {
    throw new Error(`Unsupported algo order type: ${params.type}`);
  }
}

/**
 * Cancel an algo order using Algo Order API
 * @param {string} symbol - Trading symbol
 * @param {number|string} algoId - Algo order ID
 * @param {string} [clientAlgoId] - Client algo order ID
 * @returns {Promise<object>} Cancel response
 */
export async function cancelAlgoOrder(symbol: string, algoId: number | string, clientAlgoId: string | null = null): Promise<any> {
  try {
    const params: any = {
      symbol,
    };

    // Use algoId or clientAlgoId (one is required)
    if (algoId) {
      params.algoId = algoId.toString();
    }
    if (clientAlgoId) {
      params.clientAlgoId = clientAlgoId;
    }

    const response: any = await del(endpoints.CANCEL_ALGO_ORDER, params, true);

    console.log(`[BinanceTrading] Algo order cancelled: ${algoId || clientAlgoId} for ${symbol}`);

    return {
      algoId: response.algoId,
      clientAlgoId: response.clientAlgoId,
      code: response.code,
      msg: response.msg,
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to cancel algo order:', error.message);
    throw error;
  }
}

/**
 * Cancel all algo orders for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<object>} Cancel response
 */
export async function cancelAllAlgoOrders(symbol: string): Promise<any> {
  try {
    const response: any = await del(endpoints.CANCEL_ALL_ALGO_ORDERS, { symbol }, true);
    console.log(`[BinanceTrading] All algo orders cancelled for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to cancel all algo orders:', error.message);
    throw error;
  }
}

/**
 * Get open algo orders for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<Array>} Array of open algo orders
 */
export async function getOpenAlgoOrders(symbol: string): Promise<any[]> {
  try {
    const response: any = await get(endpoints.ALGO_ORDER, { symbol }, true);
    
    return response.map((order: any) => ({
      orderId: order.algoId,
      clientOrderId: order.clientAlgoId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      positionSide: order.positionSide,
      price: order.price ? parseFloat(order.price) : null,
      stopPrice: order.stopPrice ? parseFloat(order.stopPrice) : null,
      triggerPrice: order.triggerPrice ? parseFloat(order.triggerPrice) : null,
      origQty: parseFloat(order.origQty),
      executedQty: parseFloat(order.executedQty),
      cummulativeQuoteQty: parseFloat(order.cummulativeQuoteQty),
      status: order.status,
      timeInForce: order.timeInForce,
      transactTime: order.transactTime,
      updateTime: order.updateTime,
    }));
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to get open algo orders:', error.message);
    throw error;
  }
}

/**
 * Place a new order
 * @param {object} params - Order parameters
 * @param {string} params.symbol - Trading symbol
 * @param {string} params.side - BUY or SELL
 * @param {string} params.type - Order type (MARKET, LIMIT, STOP_MARKET, TAKE_PROFIT_MARKET, etc.)
 * @param {string} params.quantity - Order quantity
 * @param {string} [params.price] - Order price (for LIMIT orders)
 * @param {string} [params.stopPrice] - Stop price (for STOP orders)
 * @param {string} [params.timeInForce] - Time in force (GTC, IOC, FOK, GTX)
 * @param {boolean} [params.reduceOnly] - Reduce only flag
 * @param {string} [params.positionSide] - Position side (LONG, SHORT, BOTH)
 * @returns {Promise<object>} Order response
 */
export async function placeOrder(params: OrderParams): Promise<any> {
  try {
    const response: any = await post(endpoints.ORDER, params, true);
    
    console.log(`[BinanceTrading] Order placed: ${params.side} ${params.quantity} ${params.symbol} (${params.type})`);
    
    return {
      orderId: response.orderId,
      clientOrderId: response.clientOrderId,
      symbol: response.symbol,
      side: response.side,
      type: response.type,
      price: response.price ? parseFloat(response.price) : null,
      stopPrice: response.stopPrice ? parseFloat(response.stopPrice) : null,
      origQty: parseFloat(response.origQty),
      executedQty: parseFloat(response.executedQty),
      cummulativeQuoteQty: parseFloat(response.cummulativeQuoteQty),
      status: response.status,
      timeInForce: response.timeInForce,
      transactTime: response.transactTime,
      updateTime: response.updateTime,
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to place order:', error.message);
    throw error;
  }
}

/**
 * Test a new order (validates without placing)
 * @param {object} params - Order parameters
 * @returns {Promise<object>} Test response
 */
export async function testOrder(params: OrderParams): Promise<any> {
  try {
    const response: any = await post(endpoints.ORDER_TEST, params, true);
    console.log(`[BinanceTrading] Order test successful for ${params.symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceTrading] Order test failed:', error.message);
    throw error;
  }
}

/**
 * Cancel an order
 * @param {string} symbol - Trading symbol
 * @param {number} orderId - Order ID
 * @param {string} [origClientOrderId] - Original client order ID
 * @returns {Promise<object>} Cancel response
 */
export async function cancelOrder(symbol: string, orderId: number, origClientOrderId: string | null = null): Promise<any> {
  try {
    const params: any = {
      symbol,
      orderId: orderId.toString(),
    };
    
    if (origClientOrderId) {
      params.origClientOrderId = origClientOrderId;
    }
    
    const response: any = await del(endpoints.CANCEL_ORDER, params, true);
    
    console.log(`[BinanceTrading] Order cancelled: ${orderId} for ${symbol}`);
    
    return {
      orderId: response.orderId,
      clientOrderId: response.clientOrderId,
      symbol: response.symbol,
      status: response.status,
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to cancel order:', error.message);
    throw error;
  }
}

/**
 * Cancel all orders for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<object>} Cancel response
 */
export async function cancelAllOrders(symbol: string): Promise<any> {
  try {
    const response: any = await del(endpoints.CANCEL_ALL_ORDERS, { symbol }, true);
    console.log(`[BinanceTrading] All orders cancelled for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to cancel all orders:', error.message);
    throw error;
  }
}

/**
 * Get order details
 * @param {string} symbol - Trading symbol
 * @param {number} orderId - Order ID
 * @param {string} [origClientOrderId] - Original client order ID
 * @returns {Promise<object>} Order details
 */
export async function getOrder(symbol: string, orderId: number, origClientOrderId: string | null = null): Promise<any> {
  try {
    const params: any = {
      symbol,
      orderId: orderId.toString(),
    };
    
    if (origClientOrderId) {
      params.origClientOrderId = origClientOrderId;
    }
    
    const response: any = await get(endpoints.ORDER, params, true);
    
    return {
      orderId: response.orderId,
      clientOrderId: response.clientOrderId,
      symbol: response.symbol,
      side: response.side,
      type: response.type,
      price: parseFloat(response.price),
      origQty: parseFloat(response.origQty),
      executedQty: parseFloat(response.executedQty),
      cummulativeQuoteQty: parseFloat(response.cummulativeQuoteQty),
      status: response.status,
      timeInForce: response.timeInForce,
      transactTime: response.transactTime,
      updateTime: response.updateTime,
    };
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to get order:', error.message);
    throw error;
  }
}

/**
 * Get all open orders
 * @param {string} [symbol] - Trading symbol (optional)
 * @returns {Promise<Array>} Array of open orders
 */
export async function getOpenOrders(symbol: string | null = null): Promise<any[]> {
  try {
    const params = symbol ? { symbol } : {};
    const response: any = await get(endpoints.OPEN_ORDERS, params, true);
    
    return response.map((order: any) => ({
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: parseFloat(order.origQty),
      price: parseFloat(order.price),
      stopPrice: parseFloat(order.stopPrice || 0),
      status: order.status,
      timeInForce: order.timeInForce,
      updateTime: order.updateTime,
    }));
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to get open orders:', error.message);
    throw error;
  }
}

/**
 * Get all orders for a symbol
 * @param {string} symbol - Trading symbol
 * @param {number} [limit] - Number of orders to return (default 500, max 1000)
 * @returns {Promise<Array>} Array of orders
 */
export async function getAllOrders(symbol: string, limit: number = 500): Promise<any[]> {
  try {
    const response: any = await get(endpoints.ALL_ORDERS, {
      symbol,
      limit: limit.toString(),
    }, true);
    
    return response.map((order: any) => ({
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: parseFloat(order.origQty),
      price: parseFloat(order.price),
      stopPrice: parseFloat(order.stopPrice || 0),
      status: order.status,
      timeInForce: order.timeInForce,
      transactTime: order.transactTime,
    }));
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to get all orders:', error.message);
    throw error;
  }
}

/**
 * Get user trades for a symbol
 * @param {string} symbol - Trading symbol
 * @param {number} [limit] - Number of trades to return (default 500, max 1000)
 * @returns {Promise<Array>} Array of trades
 */
export async function getUserTrades(symbol: string, limit: number = 500): Promise<any[]> {
  try {
    const response: any = await get(endpoints.USER_TRADES, {
      symbol,
      limit: limit.toString(),
    }, true);
    
    return response.map((trade: any) => ({
      orderId: trade.orderId,
      symbol: trade.symbol,
      side: trade.side,
      price: parseFloat(trade.price),
      qty: parseFloat(trade.qty),
      commission: parseFloat(trade.commission),
      commissionAsset: trade.commissionAsset,
      time: trade.time,
      isMaker: trade.isMaker,
    }));
  } catch (error: any) {
    console.error('[BinanceTrading] Failed to get user trades:', error.message);
    throw error;
  }
}
