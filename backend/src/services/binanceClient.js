/**
 * Binance Futures Client Service (REST API)
 * 
 * This module provides a wrapper around Binance Futures REST API
 * using the official REST API instead of the SDK
 */

import { validateConfig } from './binance/config.js';
import { getServerTime } from './binance/market.js';
import { getBalance } from './binance/account.js';
import { getCurrentPosition as getCurrentPositionAPI, getPositionRisk as getPositionRiskAPI } from './binance/account.js';
import { placeOrder as placeOrderAPI, testOrder, cancelOrder as cancelOrderAPI, cancelAllOrders as cancelAllOrdersAPI, getOpenOrders as getOpenOrdersAPI } from './binance/trading.js';
import { setLeverage as setLeverageAPI, setMarginType as setMarginTypeAPI } from './binance/trading.js';

/**
 * Initialize Binance Client
 */
export function initTestnetClient() {
  if (!validateConfig()) {
    console.log('[BinanceClient] Configuration validation failed');
    return null;
  }

  console.log('[BinanceClient] Client initialized successfully (REST API mode)');
  return {}; // Return empty object - we use module functions
}

/**
 * Test connection to Binance
 */
export async function testConnection(client) {
  try {
    const serverTime = await getServerTime();
    console.log('[BinanceClient] Connection test successful, server time:', serverTime);
    return { success: true, serverTime };
  } catch (error) {
    console.error('[BinanceClient] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get account balance from Binance
 * Returns full account information including all balances
 */
export async function getAccountBalance(client) {
  try {
    const balance = await getBalance();
    return balance;
  } catch (error) {
    console.error('[BinanceClient] Failed to get account balance:', error.message);
    throw error;
  }
}

/**
 * Get current position for a symbol
 */
export async function getCurrentPosition(client, symbol) {
  try {
    const position = await getCurrentPositionAPI(symbol);
    return position;
  } catch (error) {
    console.error('[BinanceClient] Failed to get current position:', error.message);
    throw error;
  }
}

/**
 * Place market order
 */
export async function placeMarketOrder(client, symbol, side, quantity) {
  try {
    const response = await placeOrderAPI({
      symbol,
      side,
      type: 'MARKET',
      quantity: quantity.toString(),
    });
    
    console.log(`[BinanceClient] Market order placed: ${side} ${quantity} ${symbol}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to place market order:', error.message);
    throw error;
  }
}

/**
 * Place limit order
 */
export async function placeLimitOrder(client, symbol, side, quantity, price) {
  try {
    const response = await placeOrderAPI({
      symbol,
      side,
      type: 'LIMIT',
      quantity: quantity.toString(),
      price: price.toString(),
      timeInForce: 'GTC',
    });
    
    console.log(`[BinanceClient] Limit order placed: ${side} ${quantity} ${symbol} @ ${price}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to place limit order:', error.message);
    throw error;
  }
}

/**
 * Place stop loss order (STOP_MARKET)
 */
export async function placeStopLossOrder(client, symbol, side, quantity, stopPrice) {
  try {
    const response = await placeOrderAPI({
      symbol,
      side,
      type: 'STOP_MARKET',
      quantity: quantity.toString(),
      stopPrice: stopPrice.toString(),
      reduceOnly: true, // Close position on trigger
    });
    
    console.log(`[BinanceClient] Stop loss order placed: ${side} ${quantity} ${symbol} @ ${stopPrice}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to place stop loss order:', error.message);
    throw error;
  }
}

/**
 * Place take profit order (TAKE_PROFIT_MARKET)
 */
export async function placeTakeProfitOrder(client, symbol, side, quantity, price) {
  try {
    const response = await placeOrderAPI({
      symbol,
      side,
      type: 'TAKE_PROFIT_MARKET',
      quantity: quantity.toString(),
      stopPrice: price.toString(),
      reduceOnly: true, // Close position on trigger
    });
    
    console.log(`[BinanceClient] Take profit order placed: ${side} ${quantity} ${symbol} @ ${price}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to place take profit order:', error.message);
    throw error;
  }
}

/**
 * Cancel order by ID
 */
export async function cancelOrder(client, symbol, orderId) {
  try {
    const response = await cancelOrderAPI(symbol, orderId);
    console.log(`[BinanceClient] Order cancelled: ${orderId} for ${symbol}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to cancel order:', error.message);
    throw error;
  }
}

/**
 * Cancel all orders for a symbol
 */
export async function cancelAllOrders(client, symbol) {
  try {
    const response = await cancelAllOrdersAPI(symbol);
    console.log(`[BinanceClient] All orders cancelled for ${symbol}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to cancel all orders:', error.message);
    throw error;
  }
}

/**
 * Get open orders for a symbol
 */
export async function getOpenOrders(client, symbol) {
  try {
    const orders = await getOpenOrdersAPI(symbol);
    return orders;
  } catch (error) {
    console.error('[BinanceClient] Failed to get open orders:', error.message);
    throw error;
  }
}

/**
 * Get position risk information
 */
export async function getPositionRisk(client, symbol) {
  try {
    const positions = await getPositionRiskAPI(symbol);
    return positions;
  } catch (error) {
    console.error('[BinanceClient] Failed to get position risk:', error.message);
    throw error;
  }
}

/**
 * Set leverage for a symbol
 */
export async function setLeverage(client, symbol, leverage) {
  try {
    const response = await setLeverageAPI(symbol, leverage);
    console.log(`[BinanceClient] Leverage set to ${leverage}x for ${symbol}`);
    return response;
  } catch (error) {
    console.error('[BinanceClient] Failed to set leverage:', error.message);
    throw error;
  }
}

/**
 * Set margin type (ISOLATED or CROSSED)
 */
export async function setMarginType(client, symbol, marginType) {
  try {
    const response = await setMarginTypeAPI(symbol, marginType);
    console.log(`[BinanceClient] Margin type set to ${marginType} for ${symbol}`);
    return response;
  } catch (error) {
    // Ignore "No need to change margin type" error - it means margin type is already correct
    if (error.message.includes('No need to change margin type')) {
      console.log(`[BinanceClient] Margin type already set to ${marginType} for ${symbol}`);
      return { symbol, marginType };
    }
    console.error('[BinanceClient] Failed to set margin type:', error.message);
    throw error;
  }
}

