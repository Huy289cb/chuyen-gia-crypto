/**
 * Binance Futures Client Service (REST API)
 *
 * This module provides a wrapper around Binance Futures REST API
 * using the official REST API instead of the SDK
 */
import { OrderIntent } from './binance-hedge-mode';
import { evaluateNormalizedQuantity, normalizeToStepSize as normalizeQtyToStep } from '../utils/order-quantity';
/**
 * Fetch real position from Binance for a symbol
 * Optional function to validate currentPosition before CLOSE orders
 *
 * @param symbol - Trading symbol (e.g., BTCUSDT)
 * @returns Current position info: { positionAmt: number, positionSide?: string }
 */
export declare function fetchRealPositionFromBinance(symbol: string): Promise<{
    positionAmt: number;
    positionSide?: string;
} | null>;
/** Re-export for callers that need step rounding without a full Binance round-trip. */
export { normalizeQtyToStep as normalizeToStepSize };
/**
 * Get precision filters for a symbol
 */
export declare function getSymbolFilters(symbol: string): Promise<{
    stepSize: number;
    tickSize: number;
    minQty: number;
    maxQty: number;
    minPrice: number;
    maxPrice: number;
    minNotional: number;
}>;
/**
 * Normalize quantity to exchange stepSize and validate minQty before placing orders.
 */
export declare function normalizeQuantityForSymbol(symbol: string, quantity: number): Promise<ReturnType<typeof evaluateNormalizedQuantity> & {
    tickSize?: number;
}>;
export declare function initTestnetClient(): any;
/**
 * Test connection to Binance
 */
export declare function testConnection(_client: any): Promise<any>;
/**
 * Get exchange information including trading rules and filters
 * @param {object} client - Client instance (not used for public endpoints)
 * @param {string} symbol - Optional symbol to filter (e.g., BTCUSDT)
 * @returns {Promise<object>} Exchange information with symbol filters
 */
export declare function getExchangeInfo(_client: any, symbol?: string | null): Promise<any>;
/**
 * Get account balance from Binance
 * Returns full account information including all balances
 */
export declare function getAccountBalance(_client: any): Promise<any>;
/**
 * Get current position for a symbol
 */
export declare function getCurrentPosition(_client: any, symbol: string): Promise<any>;
/**
 * Place market order
 */
export declare function placeMarketOrder(_client: any, symbol: string, side: 'BUY' | 'SELL', quantity: number, intent: OrderIntent, currentPosition?: {
    positionAmt: number;
    positionSide?: string;
} | null, positionSide?: string | null): Promise<any>;
/**
 * Place limit order
 */
export declare function placeLimitOrder(_client: any, symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number, intent: OrderIntent, currentPosition?: {
    positionAmt: number;
    positionSide?: string;
} | null, positionSide?: string | null, newClientOrderId?: string | null): Promise<any>;
/**
 * Place stop loss order (STOP_MARKET)
 * Uses specific Algo Order API endpoints when positionSide is set (hedge mode)
 */
export declare function placeStopLossOrder(_client: any, symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number, intent: OrderIntent, currentPosition?: {
    positionAmt: number;
    positionSide?: string;
} | null, positionSide?: string | null): Promise<any>;
/**
 * Place take profit order (TAKE_PROFIT_MARKET)
 * Uses specific Algo Order API endpoints when positionSide is set (hedge mode)
 */
export declare function placeTakeProfitOrder(_client: any, symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number, intent: OrderIntent, currentPosition?: {
    positionAmt: number;
    positionSide?: string;
} | null, positionSide?: string | null): Promise<any>;
/**
 * Cancel order by ID
 */
export declare function cancelOrder(_client: any, symbol: string, orderId: number): Promise<any>;
/**
 * Cancel all orders for a symbol
 */
export declare function cancelAllOrders(_client: any, symbol: string): Promise<any>;
/**
 * Cancel an algo order by ID
 */
export declare function cancelAlgoOrder(_client: any, symbol: string, algoId: number | string, clientAlgoId?: string | null): Promise<any>;
/**
 * Cancel all algo orders for a symbol
 */
export declare function cancelAllAlgoOrders(_client: any, symbol: string): Promise<any>;
/**
 * Get open orders for a symbol
 */
export declare function getOpenOrders(_client: any, symbol: string): Promise<any>;
/**
 * Get open algo orders for a symbol (STOP_MARKET, TAKE_PROFIT_MARKET)
 */
export declare function getOpenAlgoOrders(_client: any, symbol: string): Promise<any>;
/**
 * Get position risk information
 */
export declare function getPositionRisk(_client: any, symbol: string): Promise<any>;
/**
 * Set leverage for a symbol
 */
export declare function setLeverage(_client: any, symbol: string, leverage: number): Promise<any>;
/**
 * Set margin type (ISOLATED or CROSSED)
 */
export declare function setMarginType(_client: any, symbol: string, marginType: string): Promise<any>;
//# sourceMappingURL=binanceClient.d.ts.map