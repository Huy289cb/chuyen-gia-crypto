/**
 * Binance Futures Trading Module
 *
 * Trading endpoints for Binance Futures
 */
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
export declare function setLeverage(symbol: string, leverage: number): Promise<any>;
/**
 * Set margin type for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {string} marginType - Margin type (ISOLATED or CROSSED)
 * @returns {Promise<object>} Response data
 */
export declare function setMarginType(symbol: string, marginType: string): Promise<any>;
/**
 * Get current position mode (dual side = hedge mode)
 */
export declare function getDualSidePosition(): Promise<boolean>;
/**
 * Set position mode (dual position side)
 * @param {boolean} dual - True for dual position side, false for hedge mode disabled
 * @returns {Promise<object>} Response data
 */
export declare function setPositionMode(dual: boolean): Promise<any>;
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
export declare function placeStopMarketOrder(params: StopMarketOrderParams): Promise<any>;
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
export declare function placeTakeProfitMarketOrder(params: TakeProfitMarketOrderParams): Promise<any>;
/**
 * Place a new algo order (STOP_MARKET, TAKE_PROFIT_MARKET for hedge mode) - DEPRECATED
 * Use placeStopMarketOrder or placeTakeProfitMarket instead
 * @deprecated
 */
export declare function placeAlgoOrder(params: any): Promise<any>;
/**
 * Cancel an algo order using Algo Order API
 * @param {string} symbol - Trading symbol
 * @param {number|string} algoId - Algo order ID
 * @param {string} [clientAlgoId] - Client algo order ID
 * @returns {Promise<object>} Cancel response
 */
export declare function cancelAlgoOrder(symbol: string, algoId: number | string, clientAlgoId?: string | null): Promise<any>;
/**
 * Cancel all algo orders for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<object>} Cancel response
 */
export declare function cancelAllAlgoOrders(symbol: string): Promise<any>;
/**
 * Get open algo orders for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<Array>} Array of open algo orders
 */
export declare function getOpenAlgoOrders(symbol: string): Promise<any[]>;
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
export declare function placeOrder(params: OrderParams): Promise<any>;
/**
 * Test a new order (validates without placing)
 * @param {object} params - Order parameters
 * @returns {Promise<object>} Test response
 */
export declare function testOrder(params: OrderParams): Promise<any>;
/**
 * Cancel an order
 * @param {string} symbol - Trading symbol
 * @param {number} orderId - Order ID
 * @param {string} [origClientOrderId] - Original client order ID
 * @returns {Promise<object>} Cancel response
 */
export declare function cancelOrder(symbol: string, orderId: number, origClientOrderId?: string | null): Promise<any>;
/**
 * Cancel all orders for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<object>} Cancel response
 */
export declare function cancelAllOrders(symbol: string): Promise<any>;
/**
 * Get order details
 * @param {string} symbol - Trading symbol
 * @param {number} orderId - Order ID
 * @param {string} [origClientOrderId] - Original client order ID
 * @returns {Promise<object>} Order details
 */
export declare function getOrder(symbol: string, orderId: number, origClientOrderId?: string | null): Promise<any>;
/**
 * Get all open orders
 * @param {string} [symbol] - Trading symbol (optional)
 * @returns {Promise<Array>} Array of open orders
 */
export declare function getOpenOrders(symbol?: string | null): Promise<any[]>;
/**
 * Get all orders for a symbol
 * @param {string} symbol - Trading symbol
 * @param {number} [limit] - Number of orders to return (default 500, max 1000)
 * @returns {Promise<Array>} Array of orders
 */
export declare function getAllOrders(symbol: string, limit?: number): Promise<any[]>;
export interface GetUserTradesOptions {
    limit?: number;
    startTime?: number;
    endTime?: number;
    fromId?: number;
}
/**
 * Get user trades for a symbol
 */
export declare function getUserTrades(symbol: string, limitOrOptions?: number | GetUserTradesOptions): Promise<any[]>;
export {};
//# sourceMappingURL=trading.d.ts.map