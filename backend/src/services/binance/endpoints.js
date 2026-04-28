/**
 * Binance Futures API Endpoints
 * 
 * All REST API endpoints for Binance Futures
 */

export const endpoints = {
  // Public endpoints
  TIME: '/fapi/v1/time',
  KLINE: '/fapi/v1/klines',
  PRICE: '/fapi/v1/ticker/price',
  BOOK_TICKER: '/fapi/v1/ticker/bookTicker',
  
  // Account endpoints (SIGNED)
  ACCOUNT: '/fapi/v3/account',
  BALANCE: '/fapi/v3/balance',
  POSITION_RISK: '/fapi/v3/positionRisk',
  
  // Trading endpoints (SIGNED)
  ORDER: '/fapi/v1/order',
  ORDER_TEST: '/fapi/v1/order/test',
  CANCEL_ORDER: '/fapi/v1/order',
  CANCEL_ALL_ORDERS: '/fapi/v1/allOpenOrders',
  OPEN_ORDERS: '/fapi/v1/openOrders',
  ALL_ORDERS: '/fapi/v1/allOrders',
  USER_TRADES: '/fapi/v1/userTrades',
  
  // Position management (SIGNED)
  LEVERAGE: '/fapi/v1/leverage',
  MARGIN_TYPE: '/fapi/v1/marginType',
  POSITION_MODE: '/fapi/v1/positionSide/dual',
  POSITION_MARGIN: '/fapi/v1/positionMargin',
  
  // Algo Order API (SIGNED) - for SL/TP in hedge mode
  ALGO_ORDER: '/fapi/v1/order',
  CANCEL_ALGO_ORDER: '/fapi/v1/order',
  CANCEL_ALL_ALGO_ORDERS: '/fapi/v1/allOpenOrders',
  
  // User Data Stream (SIGNED)
  LISTEN_KEY: '/fapi/v1/listenKey',
};
