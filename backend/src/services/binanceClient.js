/**
 * Binance Futures Testnet Client Service
 * 
 * This module provides a wrapper around Binance Futures Testnet API
 * with error handling, retry logic, and rate limiting
 */

import { Spot, Futures } from '@binance/connector';
import { binanceConfig, getBaseUrl } from '../config/binance.js';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RATE_LIMIT_DELAY_MS = 100;

// Rate limit tracking
let requestCount = 0;
let lastResetTime = Date.now();

/**
 * Initialize Binance Testnet Client
 */
export function initTestnetClient() {
  if (!binanceConfig.enabled) {
    console.log('[BinanceClient] Testnet is disabled, skipping client initialization');
    return null;
  }

  if (!binanceConfig.apiKey || !binanceConfig.secretKey) {
    console.error('[BinanceClient] API keys are missing');
    return null;
  }

  try {
    const client = new Futures(
      binanceConfig.apiKey,
      binanceConfig.secretKey,
      { baseURL: getBaseUrl() }
    );
    
    console.log('[BinanceClient] Testnet client initialized successfully');
    return client;
  } catch (error) {
    console.error('[BinanceClient] Failed to initialize client:', error.message);
    return null;
  }
}

/**
 * Test connection to Binance Testnet
 */
export async function testConnection(client) {
  if (!client) {
    return { success: false, error: 'Client not initialized' };
  }

  try {
    const response = await client.serverTime();
    console.log('[BinanceClient] Connection test successful, server time:', response.data.serverTime);
    return { success: true, serverTime: response.data.serverTime };
  } catch (error) {
    console.error('[BinanceClient] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get account balance from Binance Testnet
 */
export async function getAccountBalance(client) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.account();
    const balances = response.data.assets || [];
    
    // Find USDT balance
    const usdtBalance = balances.find(asset => asset.asset === 'USDT');
    
    return {
      walletBalance: parseFloat(usdtBalance?.walletBalance || 0),
      availableBalance: parseFloat(usdtBalance?.availableBalance || 0),
      totalWalletBalance: parseFloat(response.data.totalWalletBalance || 0),
      totalUnrealizedProfit: parseFloat(response.data.totalUnrealizedProfit || 0),
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to get account balance:', error.message);
    throw error;
  }
}

/**
 * Get current position for a symbol
 */
export async function getCurrentPosition(client, symbol) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.getPositionRisk({ symbol });
    const positions = response.data || [];
    
    // Find position with non-zero quantity
    const position = positions.find(pos => parseFloat(pos.positionAmt) !== 0);
    
    if (!position) {
      return null;
    }
    
    return {
      symbol: position.symbol,
      positionAmt: parseFloat(position.positionAmt),
      entryPrice: parseFloat(position.entryPrice),
      markPrice: parseFloat(position.markPrice),
      unRealizedProfit: parseFloat(position.unRealizedProfit),
      leverage: parseInt(position.leverage),
      positionSide: position.positionSide,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to get current position:', error.message);
    throw error;
  }
}

/**
 * Place market order
 */
export async function placeMarketOrder(client, symbol, side, quantity) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.newOrder(symbol, side, 'MARKET', {
      quantity: quantity.toString(),
    });
    
    console.log(`[BinanceClient] Market order placed: ${side} ${quantity} ${symbol}`);
    return {
      orderId: response.data.orderId,
      clientOrderId: response.data.clientOrderId,
      symbol: response.data.symbol,
      side: response.data.side,
      type: response.data.type,
      transactTime: response.data.transactTime,
      executedQty: parseFloat(response.data.executedQty),
      cummulativeQuoteQty: parseFloat(response.data.cummulativeQuoteQty),
      status: response.data.status,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to place market order:', error.message);
    throw error;
  }
}

/**
 * Place limit order
 */
export async function placeLimitOrder(client, symbol, side, quantity, price) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.newOrder(symbol, side, 'LIMIT', {
      quantity: quantity.toString(),
      price: price.toString(),
      timeInForce: 'GTC',
    });
    
    console.log(`[BinanceClient] Limit order placed: ${side} ${quantity} ${symbol} @ ${price}`);
    return {
      orderId: response.data.orderId,
      clientOrderId: response.data.clientOrderId,
      symbol: response.data.symbol,
      side: response.data.side,
      type: response.data.type,
      price: parseFloat(response.data.price),
      transactTime: response.data.transactTime,
      status: response.data.status,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to place limit order:', error.message);
    throw error;
  }
}

/**
 * Place stop loss order (STOP_MARKET)
 */
export async function placeStopLossOrder(client, symbol, side, quantity, stopPrice) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.newOrder(symbol, side, 'STOP_MARKET', {
      quantity: quantity.toString(),
      stopPrice: stopPrice.toString(),
      closePosition: 'true', // Close position on trigger
    });
    
    console.log(`[BinanceClient] Stop loss order placed: ${side} ${quantity} ${symbol} @ ${stopPrice}`);
    return {
      orderId: response.data.orderId,
      clientOrderId: response.data.clientOrderId,
      symbol: response.data.symbol,
      side: response.data.side,
      type: response.data.type,
      stopPrice: parseFloat(response.data.stopPrice),
      transactTime: response.data.transactTime,
      status: response.data.status,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to place stop loss order:', error.message);
    throw error;
  }
}

/**
 * Place take profit order (TAKE_PROFIT_MARKET)
 */
export async function placeTakeProfitOrder(client, symbol, side, quantity, price) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.newOrder(symbol, side, 'TAKE_PROFIT_MARKET', {
      quantity: quantity.toString(),
      stopPrice: price.toString(),
      closePosition: 'true', // Close position on trigger
    });
    
    console.log(`[BinanceClient] Take profit order placed: ${side} ${quantity} ${symbol} @ ${price}`);
    return {
      orderId: response.data.orderId,
      clientOrderId: response.data.clientOrderId,
      symbol: response.data.symbol,
      side: response.data.side,
      type: response.data.type,
      stopPrice: parseFloat(response.data.stopPrice),
      transactTime: response.data.transactTime,
      status: response.data.status,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to place take profit order:', error.message);
    throw error;
  }
}

/**
 * Cancel order by ID
 */
export async function cancelOrder(client, symbol, orderId) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.cancelOrder(symbol, { orderId });
    console.log(`[BinanceClient] Order cancelled: ${orderId} for ${symbol}`);
    return {
      orderId: response.data.orderId,
      symbol: response.data.symbol,
      status: response.data.status,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to cancel order:', error.message);
    throw error;
  }
}

/**
 * Cancel all orders for a symbol
 */
export async function cancelAllOrders(client, symbol) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.cancelAllOpenOrders(symbol);
    console.log(`[BinanceClient] All orders cancelled for ${symbol}`);
    return response.data;
  } catch (error) {
    console.error('[BinanceClient] Failed to cancel all orders:', error.message);
    throw error;
  }
}

/**
 * Get open orders for a symbol
 */
export async function getOpenOrders(client, symbol) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.getOpenOrders(symbol);
    const orders = response.data || [];
    
    return orders.map(order => ({
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
  } catch (error) {
    console.error('[BinanceClient] Failed to get open orders:', error.message);
    throw error;
  }
}

/**
 * Get position risk information
 */
export async function getPositionRisk(client, symbol) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.getPositionRisk({ symbol });
    const positions = response.data || [];
    
    return positions.map(pos => ({
      symbol: pos.symbol,
      positionAmt: parseFloat(pos.positionAmt),
      entryPrice: parseFloat(pos.entryPrice),
      markPrice: parseFloat(pos.markPrice),
      unRealizedProfit: parseFloat(pos.unRealizedProfit),
      liquidationPrice: parseFloat(pos.liquidationPrice),
      leverage: parseInt(pos.leverage),
      maxNotionalValue: parseFloat(pos.maxNotionalValue),
      marginType: pos.marginType,
      isolatedMargin: parseFloat(pos.isolatedMargin),
      isAutoAddMargin: pos.isAutoAddMargin === 'true',
      positionSide: pos.positionSide,
      notional: parseFloat(pos.notional),
      isolatedWallet: parseFloat(pos.isolatedWallet),
    }));
  } catch (error) {
    console.error('[BinanceClient] Failed to get position risk:', error.message);
    throw error;
  }
}

/**
 * Set leverage for a symbol
 */
export async function setLeverage(client, symbol, leverage) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.changeLeverage({ symbol, leverage: leverage.toString() });
    console.log(`[BinanceClient] Leverage set to ${leverage}x for ${symbol}`);
    return {
      symbol: response.data.symbol,
      leverage: parseInt(response.data.leverage),
      maxNotionalValue: response.data.maxNotionalValue,
    };
  } catch (error) {
    console.error('[BinanceClient] Failed to set leverage:', error.message);
    throw error;
  }
}

/**
 * Set margin type (ISOLATED or CROSSED)
 */
export async function setMarginType(client, symbol, marginType) {
  if (!client) {
    throw new Error('Client not initialized');
  }

  try {
    const response = await client.changeMarginType({ symbol, marginType });
    console.log(`[BinanceClient] Margin type set to ${marginType} for ${symbol}`);
    return response.data;
  } catch (error) {
    console.error('[BinanceClient] Failed to set margin type:', error.message);
    throw error;
  }
}

/**
 * Helper function to delay execution (for rate limiting)
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper function to retry failed requests
 */
async function retryWithBackoff(fn, retries = MAX_RETRIES) {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) {
      throw error;
    }
    
    // Check if error is rate limit related
    if (error.response?.status === 429 || error.code === -1003) {
      console.warn(`[BinanceClient] Rate limit hit, waiting ${RETRY_DELAY_MS}ms before retry...`);
      await delay(RETRY_DELAY_MS);
    }
    
    console.warn(`[BinanceClient] Request failed, retrying... (${retries} attempts left)`);
    await delay(RETRY_DELAY_MS);
    return retryWithBackoff(fn, retries - 1);
  }
}

/**
 * Check and enforce rate limits
 */
function checkRateLimit() {
  const now = Date.now();
  const elapsed = now - lastResetTime;
  
  // Reset counter every minute
  if (elapsed > 60000) {
    requestCount = 0;
    lastResetTime = now;
  }
  
  requestCount++;
  
  if (requestCount > binanceConfig.rateLimits.requestWeight) {
    const waitTime = 60000 - elapsed;
    console.warn(`[BinanceClient] Rate limit reached, waiting ${waitTime}ms`);
    return delay(waitTime);
  }
  
  return Promise.resolve();
}
