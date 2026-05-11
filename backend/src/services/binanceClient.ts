/**
 * Binance Futures Client Service (REST API)
 * 
 * This module provides a wrapper around Binance Futures REST API
 * using the official REST API instead of the SDK
 */

import { validateConfig } from './binance/config';
import { getServerTime, getExchangeInfo as getExchangeInfoAPI } from './binance/market';
import { getBalance } from './binance/account';
import { getCurrentPosition as getCurrentPositionAPI, getPositionRisk as getPositionRiskAPI } from './binance/account';
import { placeOrder as placeOrderAPI, cancelOrder as cancelOrderAPI, cancelAllOrders as cancelAllOrdersAPI, getOpenOrders as getOpenOrdersAPI } from './binance/trading';
import { setLeverage as setLeverageAPI, setMarginType as setMarginTypeAPI, placeStopMarketOrder as placeStopMarketOrderAPI, placeTakeProfitMarketOrder as placeTakeProfitMarketOrderAPI, cancelAlgoOrder as cancelAlgoOrderAPI, cancelAllAlgoOrders as cancelAllAlgoOrdersAPI, getOpenAlgoOrders as getOpenAlgoOrdersAPI } from './binance/trading';
import { get } from './binance/client';
import { endpoints } from './binance/endpoints';

// Cache for exchange info to avoid repeated API calls
let exchangeInfoCache: any = null;
let exchangeInfoCacheTime = 0;
const EXCHANGE_INFO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get exchange info with caching (internal function for precision handling)
 */
async function getExchangeInfoCached(symbol?: string): Promise<any> {
  const now = Date.now();
  
  if (exchangeInfoCache && now - exchangeInfoCacheTime < EXCHANGE_INFO_CACHE_TTL) {
    if (symbol && exchangeInfoCache.symbols) {
      return exchangeInfoCache.symbols.find((s: any) => s.symbol === symbol) || exchangeInfoCache;
    }
    return exchangeInfoCache;
  }
  
  const params = symbol ? { symbol } : {};
  const response = await get(endpoints.EXCHANGE_INFO, params);
  
  exchangeInfoCache = response;
  exchangeInfoCacheTime = now;
  
  if (symbol && response.symbols) {
    return response.symbols.find((s: any) => s.symbol === symbol) || response;
  }
  
  return response;
}

/**
 * Normalize value to step size (for quantity precision)
 */
function normalizeToStepSize(value: number, stepSize: number): number {
  const stepDecimals = stepSize.toString().split('.')[1]?.length || 0;
  const normalized = Math.floor(value / stepSize) * stepSize;
  return parseFloat(normalized.toFixed(stepDecimals));
}

/**
 * Normalize price to tick size (for price precision)
 */
function normalizeToTickSize(price: number, tickSize: number): number {
  const tickDecimals = tickSize.toString().split('.')[1]?.length || 0;
  const normalized = Math.floor(price / tickSize) * tickSize;
  return parseFloat(normalized.toFixed(tickDecimals));
}

/**
 * Get precision filters for a symbol
 */
async function getSymbolFilters(symbol: string): Promise<{
  stepSize: number;
  tickSize: number;
  minQty: number;
  maxQty: number;
  minPrice: number;
  maxPrice: number;
  minNotional: number;
}> {
  const symbolInfo = await getExchangeInfoCached(symbol);
  
  const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
  const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
  const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
  
  return {
    stepSize: parseFloat(lotSizeFilter.stepSize),
    tickSize: parseFloat(priceFilter.tickSize),
    minQty: parseFloat(lotSizeFilter.minQty),
    maxQty: parseFloat(lotSizeFilter.maxQty),
    minPrice: parseFloat(priceFilter.minPrice),
    maxPrice: parseFloat(priceFilter.maxPrice),
    minNotional: parseFloat(minNotionalFilter.minNotional),
  };
}

export function initTestnetClient(): any {
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
export async function testConnection(_client: any): Promise<any> {
  try {
    const serverTime = await getServerTime();
    console.log('[BinanceClient] Connection test successful, server time:', serverTime);
    return { success: true, serverTime };
  } catch (error: any) {
    console.error('[BinanceClient] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get exchange information including trading rules and filters
 * @param {object} client - Client instance (not used for public endpoints)
 * @param {string} symbol - Optional symbol to filter (e.g., BTCUSDT)
 * @returns {Promise<object>} Exchange information with symbol filters
 */
export async function getExchangeInfo(_client: any, symbol: string | null = null): Promise<any> {
  try {
    const exchangeInfo = await getExchangeInfoAPI(symbol);
    console.log(`[BinanceClient] Exchange info fetched${symbol ? ` for ${symbol}` : ''}`);
    return exchangeInfo;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to get exchange info:', error.message);
    throw error;
  }
}

/**
 * Get account balance from Binance
 * Returns full account information including all balances
 */
export async function getAccountBalance(_client: any): Promise<any> {
  try {
    const balance = await getBalance();
    return balance;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to get account balance:', error.message);
    throw error;
  }
}

/**
 * Get current position for a symbol
 */
export async function getCurrentPosition(_client: any, symbol: string): Promise<any> {
  try {
    const position = await getCurrentPositionAPI(symbol);
    return position;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to get current position:', error.message);
    throw error;
  }
}

/**
 * Place market order
 */
export async function placeMarketOrder(_client: any, symbol: string, side: string, quantity: number, positionSide: string | null = null): Promise<any> {
  try {
    const params: any = {
      symbol,
      side,
      type: 'MARKET',
      quantity: quantity.toString(),
    };
    
    // Add positionSide for hedge mode (dual position side)
    if (positionSide) {
      params.positionSide = positionSide;
    }
    
    const response = await placeOrderAPI(params);
    
    // Calculate estimated fee (market orders are taker orders)
    // Binance Futures taker fee: 0.04% (0.0004)
    const executedQty = parseFloat(response.executedQty || response.origQty || quantity);
    const executedPrice = parseFloat(response.cummulativeQuoteQty || 0) / executedQty || 0;
    const orderValue = executedQty * executedPrice;
    const takerFeeRate = 0.0004; // 0.04%
    const estimatedFee = orderValue * takerFeeRate;
    
    console.log(`[BinanceClient] Market order placed: ${side} ${quantity} ${symbol}${positionSide ? ` (positionSide: ${positionSide})` : ''}, estimated fee: ${estimatedFee.toFixed(4)} USDT`);
    
    return {
      ...response,
      commission: estimatedFee,
      commissionAsset: 'USDT',
      commissionUsdt: estimatedFee,
    };
  } catch (error: any) {
    console.error('[BinanceClient] Failed to place market order:', error.message);
    throw error;
  }
}

/**
 * Place limit order
 */
export async function placeLimitOrder(_client: any, symbol: string, side: string, quantity: number, price: number, positionSide: string | null = null, newClientOrderId: string | null = null): Promise<any> {
  try {
    // Get precision filters and normalize values
    const filters = await getSymbolFilters(symbol);
    const normalizedQuantity = normalizeToStepSize(quantity, filters.stepSize);
    const normalizedPrice = normalizeToTickSize(price, filters.tickSize);
    
    console.log(`[BinanceClient] Precision normalization: quantity ${quantity} -> ${normalizedQuantity} (stepSize: ${filters.stepSize}), price ${price} -> ${normalizedPrice} (tickSize: ${filters.tickSize})`);

    const params: any = {
      symbol,
      side,
      type: 'LIMIT',
      quantity: normalizedQuantity.toString(),
      price: normalizedPrice.toString(),
      timeInForce: 'GTC',
    };
    
    // Add positionSide for hedge mode (dual position side)
    if (positionSide) {
      params.positionSide = positionSide;
    }
    
    // Add newClientOrderId for idempotency protection
    if (newClientOrderId) {
      params.newClientOrderId = newClientOrderId;
    }
    
    const response = await placeOrderAPI(params);
    
    console.log(`[BinanceClient] Limit order placed: ${side} ${normalizedQuantity} ${symbol} @ ${normalizedPrice}${positionSide ? ` (positionSide: ${positionSide})` : ''}${newClientOrderId ? ` (clientOrderId: ${newClientOrderId})` : ''}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to place limit order:', error.message);
    throw error;
  }
}

/**
 * Place stop loss order (STOP_MARKET)
 * Uses specific Algo Order API endpoints when positionSide is set (hedge mode)
 */
export async function placeStopLossOrder(_client: any, symbol: string, side: string, quantity: number, stopPrice: number, positionSide: string | null = null): Promise<any> {
  try {
    // Get precision filters and normalize values
    const filters = await getSymbolFilters(symbol);
    const normalizedQuantity = normalizeToStepSize(quantity, filters.stepSize);
    const normalizedStopPrice = normalizeToTickSize(stopPrice, filters.tickSize);
    
    console.log(`[BinanceClient] Precision normalization for SL: quantity ${quantity} -> ${normalizedQuantity}, stopPrice ${stopPrice} -> ${normalizedStopPrice}`);

    const params: any = {
      symbol,
      side,
      quantity: normalizedQuantity.toString(),
      stopPrice: normalizedStopPrice.toString(),
    };

    // Add positionSide for hedge mode (dual position side)
    if (positionSide) {
      params.positionSide = positionSide;
      params.closePosition = true; // Close position when triggered
      const response = await placeStopMarketOrderAPI(params);
      console.log(`[BinanceClient] Stop loss order placed: symbol=${symbol} side=${side} positionSide=${positionSide} type=STOP_MARKET stopPrice=${normalizedStopPrice}`);
      return response;
    } else {
      // In single position mode, use reduceOnly to close position
      params.type = 'STOP_MARKET';
      params.reduceOnly = true;
      const response = await placeOrderAPI(params);
      console.log(`[BinanceClient] Stop loss order placed: symbol=${symbol} side=${side} type=STOP_MARKET stopPrice=${normalizedStopPrice}`);
      return response;
    }
  } catch (error: any) {
    console.error('[BinanceClient] Failed to place stop loss order:', error.message);
    throw error;
  }
}

/**
 * Place take profit order (TAKE_PROFIT_MARKET)
 * Uses specific Algo Order API endpoints when positionSide is set (hedge mode)
 */
export async function placeTakeProfitOrder(_client: any, symbol: string, side: string, quantity: number, price: number, positionSide: string | null = null): Promise<any> {
  try {
    // Get precision filters and normalize values
    const filters = await getSymbolFilters(symbol);
    const normalizedQuantity = normalizeToStepSize(quantity, filters.stepSize);
    const normalizedPrice = normalizeToTickSize(price, filters.tickSize);
    
    console.log(`[BinanceClient] Precision normalization for TP: quantity ${quantity} -> ${normalizedQuantity}, price ${price} -> ${normalizedPrice}`);

    const params: any = {
      symbol,
      side,
      quantity: normalizedQuantity.toString(),
      stopPrice: normalizedPrice.toString(),
    };

    // Add positionSide for hedge mode (dual position side)
    if (positionSide) {
      params.positionSide = positionSide;
      params.closePosition = true; // Close position when triggered
      const response = await placeTakeProfitMarketOrderAPI(params);
      console.log(`[BinanceClient] Take profit order placed: symbol=${symbol} side=${side} positionSide=${positionSide} type=TAKE_PROFIT_MARKET price=${normalizedPrice}`);
      return response;
    } else {
      // In single position mode, use reduceOnly to close position
      params.type = 'TAKE_PROFIT_MARKET';
      params.reduceOnly = true;
      const response = await placeOrderAPI(params);
      console.log(`[BinanceClient] Take profit order placed: symbol=${symbol} side=${side} type=TAKE_PROFIT_MARKET price=${normalizedPrice}`);
      return response;
    }
  } catch (error: any) {
    console.error('[BinanceClient] Failed to place take profit order:', error.message);
    throw error;
  }
}

/**
 * Cancel order by ID
 */
export async function cancelOrder(_client: any, symbol: string, orderId: number): Promise<any> {
  try {
    const response = await cancelOrderAPI(symbol, orderId);
    console.log(`[BinanceClient] Order cancelled: ${orderId} for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to cancel order:', error.message);
    throw error;
  }
}

/**
 * Cancel all orders for a symbol
 */
export async function cancelAllOrders(_client: any, symbol: string): Promise<any> {
  try {
    const response = await cancelAllOrdersAPI(symbol);
    console.log(`[BinanceClient] All orders cancelled for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to cancel all orders:', error.message);
    throw error;
  }
}

/**
 * Cancel an algo order by ID
 */
export async function cancelAlgoOrder(_client: any, symbol: string, algoId: number | string, clientAlgoId: string | null = null): Promise<any> {
  try {
    const response = await cancelAlgoOrderAPI(symbol, algoId, clientAlgoId);
    console.log(`[BinanceClient] Algo order cancelled: ${algoId || clientAlgoId} for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to cancel algo order:', error.message);
    throw error;
  }
}

/**
 * Cancel all algo orders for a symbol
 */
export async function cancelAllAlgoOrders(_client: any, symbol: string): Promise<any> {
  try {
    const response = await cancelAllAlgoOrdersAPI(symbol);
    console.log(`[BinanceClient] All algo orders cancelled for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to cancel all algo orders:', error.message);
    throw error;
  }
}

/**
 * Get open orders for a symbol
 */
export async function getOpenOrders(_client: any, symbol: string): Promise<any> {
  try {
    const orders = await getOpenOrdersAPI(symbol);
    return orders;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to get open orders:', error.message);
    throw error;
  }
}

/**
 * Get open algo orders for a symbol (STOP_MARKET, TAKE_PROFIT_MARKET)
 */
export async function getOpenAlgoOrders(_client: any, symbol: string): Promise<any> {
  try {
    const orders = await getOpenAlgoOrdersAPI(symbol);
    return orders;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to get open algo orders:', error.message);
    throw error;
  }
}

/**
 * Get position risk information
 */
export async function getPositionRisk(_client: any, symbol: string): Promise<any> {
  try {
    const positions = await getPositionRiskAPI(symbol);
    return positions;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to get position risk:', error.message);
    throw error;
  }
}

/**
 * Set leverage for a symbol
 */
export async function setLeverage(_client: any, symbol: string, leverage: number): Promise<any> {
  try {
    const response = await setLeverageAPI(symbol, leverage);
    console.log(`[BinanceClient] Leverage set to ${leverage}x for ${symbol}`);
    return response;
  } catch (error: any) {
    console.error('[BinanceClient] Failed to set leverage:', error.message);
    throw error;
  }
}

/**
 * Set margin type (ISOLATED or CROSSED)
 */
export async function setMarginType(_client: any, symbol: string, marginType: string): Promise<any> {
  try {
    const response = await setMarginTypeAPI(symbol, marginType);
    console.log(`[BinanceClient] Margin type set to ${marginType} for ${symbol}`);
    return response;
  } catch (error: any) {
    // Ignore "No need to change margin type" error - it means margin type is already correct
    if (error.message.includes('No need to change margin type')) {
      console.log(`[BinanceClient] Margin type already set to ${marginType} for ${symbol}`);
      return { symbol, marginType };
    }
    console.error('[BinanceClient] Failed to set margin type:', error.message);
    throw error;
  }
}
