"use strict";
/**
 * Binance Futures Client Service (REST API)
 *
 * This module provides a wrapper around Binance Futures REST API
 * using the official REST API instead of the SDK
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeToStepSize = void 0;
exports.fetchRealPositionFromBinance = fetchRealPositionFromBinance;
exports.getSymbolFilters = getSymbolFilters;
exports.normalizeQuantityForSymbol = normalizeQuantityForSymbol;
exports.initTestnetClient = initTestnetClient;
exports.testConnection = testConnection;
exports.getExchangeInfo = getExchangeInfo;
exports.getAccountBalance = getAccountBalance;
exports.getCurrentPosition = getCurrentPosition;
exports.placeMarketOrder = placeMarketOrder;
exports.placeLimitOrder = placeLimitOrder;
exports.placeStopLossOrder = placeStopLossOrder;
exports.placeTakeProfitOrder = placeTakeProfitOrder;
exports.cancelOrder = cancelOrder;
exports.cancelAllOrders = cancelAllOrders;
exports.cancelAlgoOrder = cancelAlgoOrder;
exports.cancelAllAlgoOrders = cancelAllAlgoOrders;
exports.getOpenOrders = getOpenOrders;
exports.getOpenAlgoOrders = getOpenAlgoOrders;
exports.getPositionRisk = getPositionRisk;
exports.setLeverage = setLeverage;
exports.setMarginType = setMarginType;
const config_1 = require("./binance/config");
const market_1 = require("./binance/market");
const account_1 = require("./binance/account");
const account_2 = require("./binance/account");
const trading_1 = require("./binance/trading");
const trading_2 = require("./binance/trading");
const client_1 = require("./binance/client");
const endpoints_1 = require("./binance/endpoints");
const binance_hedge_mode_1 = require("./binance-hedge-mode");
const order_quantity_1 = require("../utils/order-quantity");
Object.defineProperty(exports, "normalizeToStepSize", { enumerable: true, get: function () { return order_quantity_1.normalizeToStepSize; } });
/**
 * Fetch real position from Binance for a symbol
 * Optional function to validate currentPosition before CLOSE orders
 *
 * @param symbol - Trading symbol (e.g., BTCUSDT)
 * @returns Current position info: { positionAmt: number, positionSide?: string }
 */
async function fetchRealPositionFromBinance(symbol) {
    try {
        const position = await (0, account_2.getCurrentPosition)(symbol);
        if (!position) {
            return null;
        }
        const positionAmt = typeof position.positionAmt === 'string' ? parseFloat(position.positionAmt) : position.positionAmt;
        if (!positionAmt || positionAmt === 0) {
            return null;
        }
        return {
            positionAmt: positionAmt,
            positionSide: position.positionSide,
        };
    }
    catch (error) {
        console.error(`[BinanceClient] Failed to fetch real position for ${symbol}:`, error.message);
        return null;
    }
}
// Cache for exchange info to avoid repeated API calls
let exchangeInfoCache = null;
let exchangeInfoCacheTime = 0;
const EXCHANGE_INFO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
/**
 * Get exchange info with caching (internal function for precision handling)
 */
async function getExchangeInfoCached(symbol) {
    const now = Date.now();
    if (exchangeInfoCache && now - exchangeInfoCacheTime < EXCHANGE_INFO_CACHE_TTL) {
        if (symbol && exchangeInfoCache.symbols) {
            return exchangeInfoCache.symbols.find((s) => s.symbol === symbol) || exchangeInfoCache;
        }
        return exchangeInfoCache;
    }
    const params = symbol ? { symbol } : {};
    const response = await (0, client_1.get)(endpoints_1.endpoints.EXCHANGE_INFO, params);
    exchangeInfoCache = response;
    exchangeInfoCacheTime = now;
    if (symbol && response.symbols) {
        return response.symbols.find((s) => s.symbol === symbol) || response;
    }
    return response;
}
/**
 * Normalize price to tick size (for price precision)
 */
function normalizeToTickSize(price, tickSize) {
    const tickDecimals = tickSize.toString().split('.')[1]?.length || 0;
    const normalized = Math.floor(price / tickSize) * tickSize;
    return parseFloat(normalized.toFixed(tickDecimals));
}
/**
 * Get precision filters for a symbol
 */
async function getSymbolFilters(symbol) {
    const symbolInfo = await getExchangeInfoCached(symbol);
    const lotSizeFilter = symbolInfo.filters.find((f) => f.filterType === 'LOT_SIZE');
    const priceFilter = symbolInfo.filters.find((f) => f.filterType === 'PRICE_FILTER');
    const minNotionalFilter = symbolInfo.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
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
/**
 * Normalize quantity to exchange stepSize and validate minQty before placing orders.
 */
async function normalizeQuantityForSymbol(symbol, quantity) {
    const filters = await getSymbolFilters(symbol);
    return { ...(0, order_quantity_1.evaluateNormalizedQuantity)(quantity, filters), tickSize: filters.tickSize };
}
function assertValidNormalizedQuantity(symbol, intent, check) {
    if (!check.valid) {
        throw new Error(`[BinanceClient] ${intent} order rejected for ${symbol}: ${check.reason ?? 'invalid quantity'}`);
    }
    return check.normalizedQty;
}
function initTestnetClient() {
    if (!(0, config_1.validateConfig)()) {
        console.log('[BinanceClient] Configuration validation failed');
        return null;
    }
    console.log('[BinanceClient] Client initialized successfully (REST API mode)');
    return {}; // Return empty object - we use module functions
}
/**
 * Test connection to Binance
 */
async function testConnection(_client) {
    try {
        const serverTime = await (0, market_1.getServerTime)();
        console.log('[BinanceClient] Connection test successful, server time:', serverTime);
        return { success: true, serverTime };
    }
    catch (error) {
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
async function getExchangeInfo(_client, symbol = null) {
    try {
        const exchangeInfo = await (0, market_1.getExchangeInfo)(symbol);
        console.log(`[BinanceClient] Exchange info fetched${symbol ? ` for ${symbol}` : ''}`);
        return exchangeInfo;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to get exchange info:', error.message);
        throw error;
    }
}
/**
 * Get account balance from Binance
 * Returns full account information including all balances
 */
async function getAccountBalance(_client) {
    try {
        const balance = await (0, account_1.getBalance)();
        return balance;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to get account balance:', error.message);
        throw error;
    }
}
/**
 * Get current position for a symbol
 */
async function getCurrentPosition(_client, symbol) {
    try {
        const position = await (0, account_2.getCurrentPosition)(symbol);
        return position;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to get current position:', error.message);
        throw error;
    }
}
/**
 * Place market order
 */
async function placeMarketOrder(_client, symbol, side, quantity, intent, currentPosition = null, positionSide = null) {
    // Validate intent is provided
    if (!intent) {
        throw new Error('[BinanceClient] Order rejected: intent is required (OPEN or CLOSE)');
    }
    // Validate currentPosition is provided for CLOSE orders
    if (intent === 'CLOSE' && !currentPosition) {
        throw new Error('[BinanceClient] Order rejected: currentPosition is required for CLOSE orders');
    }
    try {
        await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
        const filters = await getSymbolFilters(symbol);
        const qtyCheck = (0, order_quantity_1.evaluateNormalizedQuantity)(quantity, filters);
        const normalizedQuantity = assertValidNormalizedQuantity(symbol, intent, qtyCheck);
        console.log(`[BinanceClient] MARKET ORDER REQUEST: symbol=${symbol} side=${side} intent=${intent} ` +
            `quantity=${quantity} -> ${normalizedQuantity} (stepSize: ${filters.stepSize}) ` +
            `positionSide=${positionSide || 'N/A'} currentPosition=${currentPosition ? JSON.stringify(currentPosition) : 'N/A'}`);
        // If positionSide is explicitly provided, validate it
        if (positionSide !== null) {
            (0, binance_hedge_mode_1.validatePositionSide)(positionSide);
        }
        else {
            // Resolve positionSide based on side, intent, and current position
            positionSide = (0, binance_hedge_mode_1.resolvePositionSide)(side, intent, currentPosition);
        }
        const params = {
            symbol,
            side,
            type: 'MARKET',
            quantity: normalizedQuantity.toString(),
        };
        // Add positionSide if in HEDGE mode
        if (positionSide) {
            params.positionSide = positionSide;
        }
        const response = await (0, trading_1.placeOrder)(params);
        // Calculate estimated fee (market orders are taker orders)
        // Binance Futures taker fee: 0.04% (0.0004)
        const executedQty = parseFloat(response.executedQty || response.origQty || quantity);
        const executedPrice = parseFloat(response.cummulativeQuoteQty || 0) / executedQty || 0;
        const orderValue = executedQty * executedPrice;
        const takerFeeRate = 0.0004; // 0.04%
        const estimatedFee = orderValue * takerFeeRate;
        console.log(`[BinanceClient] MARKET ORDER PLACED: symbol=${symbol} side=${side} intent=${intent} quantity=${normalizedQuantity} positionSide=${positionSide || 'N/A'} orderId=${response.orderId} estimated fee: ${estimatedFee.toFixed(4)} USDT`);
        return {
            ...response,
            commission: estimatedFee,
            commissionAsset: 'USDT',
            commissionUsdt: estimatedFee,
        };
    }
    catch (error) {
        console.error(`[BinanceClient] MARKET ORDER FAILED: symbol=${symbol} side=${side} intent=${intent} error=${error.message}`);
        throw error;
    }
}
/**
 * Place limit order
 */
async function placeLimitOrder(_client, symbol, side, quantity, price, intent, currentPosition = null, positionSide = null, newClientOrderId = null) {
    // Validate intent is provided
    if (!intent) {
        throw new Error('[BinanceClient] Order rejected: intent is required (OPEN or CLOSE)');
    }
    // Validate currentPosition is provided for CLOSE orders
    if (intent === 'CLOSE' && !currentPosition) {
        throw new Error('[BinanceClient] Order rejected: currentPosition is required for CLOSE orders');
    }
    await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
    // Get precision filters and normalize values
    const filters = await getSymbolFilters(symbol);
    const qtyCheck = (0, order_quantity_1.evaluateNormalizedQuantity)(quantity, filters);
    const normalizedQuantity = assertValidNormalizedQuantity(symbol, intent, qtyCheck);
    const normalizedPrice = normalizeToTickSize(price, filters.tickSize);
    console.log(`[BinanceClient] Precision normalization: quantity ${quantity} -> ${normalizedQuantity} (stepSize: ${filters.stepSize}), price ${price} -> ${normalizedPrice} (tickSize: ${filters.tickSize})`);
    // Log order details before placing
    console.log(`[BinanceClient] LIMIT ORDER REQUEST: symbol=${symbol} side=${side} intent=${intent} quantity=${normalizedQuantity} price=${normalizedPrice} positionSide=${positionSide || 'N/A'} currentPosition=${currentPosition ? JSON.stringify(currentPosition) : 'N/A'}${newClientOrderId ? ` clientOrderId=${newClientOrderId}` : ''}`);
    try {
        // If positionSide is explicitly provided, validate it
        if (positionSide !== null) {
            (0, binance_hedge_mode_1.validatePositionSide)(positionSide);
        }
        else {
            // Resolve positionSide based on side, intent, and current position
            positionSide = (0, binance_hedge_mode_1.resolvePositionSide)(side, intent, currentPosition);
        }
        const params = {
            symbol,
            side,
            type: 'LIMIT',
            quantity: normalizedQuantity.toString(),
            price: normalizedPrice.toString(),
            timeInForce: 'GTC',
        };
        // Add newClientOrderId for idempotency protection
        if (newClientOrderId) {
            params.newClientOrderId = newClientOrderId;
        }
        // Add positionSide if in HEDGE mode
        if (positionSide) {
            params.positionSide = positionSide;
        }
        const response = await (0, trading_1.placeOrder)(params);
        console.log(`[BinanceClient] LIMIT ORDER PLACED: symbol=${symbol} side=${side} intent=${intent} quantity=${normalizedQuantity} price=${normalizedPrice} positionSide=${positionSide || 'N/A'} orderId=${response.orderId}${newClientOrderId ? ` clientOrderId=${newClientOrderId}` : ''}`);
        return response;
    }
    catch (error) {
        console.error(`[BinanceClient] LIMIT ORDER FAILED: symbol=${symbol} side=${side} intent=${intent} error=${error.message}`);
        throw error;
    }
}
/**
 * Place stop loss order (STOP_MARKET)
 * Uses specific Algo Order API endpoints when positionSide is set (hedge mode)
 */
async function placeStopLossOrder(_client, symbol, side, quantity, stopPrice, intent, currentPosition = null, positionSide = null) {
    // Validate intent is provided
    if (!intent) {
        throw new Error('[BinanceClient] Order rejected: intent is required (OPEN or CLOSE)');
    }
    // Validate currentPosition is provided for CLOSE orders
    if (intent === 'CLOSE' && !currentPosition) {
        throw new Error('[BinanceClient] Order rejected: currentPosition is required for CLOSE orders');
    }
    try {
        await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
        // Get precision filters and normalize values
        const filters = await getSymbolFilters(symbol);
        const qtyCheck = (0, order_quantity_1.evaluateNormalizedQuantity)(quantity, filters);
        const normalizedQuantity = assertValidNormalizedQuantity(symbol, intent, qtyCheck);
        const normalizedStopPrice = normalizeToTickSize(stopPrice, filters.tickSize);
        console.log(`[BinanceClient] Precision normalization for SL: quantity ${quantity} -> ${normalizedQuantity}, stopPrice ${stopPrice} -> ${normalizedStopPrice}`);
        // Log order details before placing
        console.log(`[BinanceClient] STOP LOSS ORDER REQUEST: symbol=${symbol} side=${side} intent=${intent} quantity=${quantity} stopPrice=${stopPrice} positionSide=${positionSide || 'N/A'} currentPosition=${currentPosition ? JSON.stringify(currentPosition) : 'N/A'}`);
        // If positionSide is explicitly provided, validate it
        if (positionSide !== null) {
            (0, binance_hedge_mode_1.validatePositionSide)(positionSide);
        }
        else {
            // Resolve positionSide based on side, intent, and current position
            positionSide = (0, binance_hedge_mode_1.resolvePositionSide)(side, intent, currentPosition);
        }
        const params = {
            symbol,
            side,
            quantity: normalizedQuantity.toString(),
            stopPrice: normalizedStopPrice.toString(),
        };
        // Add positionSide for hedge mode (dual position side)
        if (positionSide) {
            params.positionSide = positionSide;
            params.closePosition = true; // Close position when triggered
            const response = await (0, trading_2.placeStopMarketOrder)(params);
            console.log(`[BinanceClient] STOP LOSS ORDER PLACED: symbol=${symbol} side=${side} intent=${intent} positionSide=${positionSide} type=STOP_MARKET stopPrice=${normalizedStopPrice} orderId=${response.orderId || response.algoId}`);
            return response;
        }
        else {
            // ONE_WAY: algo conditional orders — omit positionSide (not allowed in one-way mode)
            const response = await (0, trading_2.placeStopMarketOrder)({
                symbol,
                side,
                quantity: params.quantity,
                stopPrice: params.stopPrice,
                reduceOnly: true,
            });
            console.log(`[BinanceClient] STOP LOSS ORDER PLACED: symbol=${symbol} side=${side} intent=${intent} ` +
                `type=STOP_MARKET (algo) stopPrice=${normalizedStopPrice} orderId=${response.orderId || response.algoId}`);
            return response;
        }
    }
    catch (error) {
        console.error(`[BinanceClient] STOP LOSS ORDER FAILED: symbol=${symbol} side=${side} intent=${intent} error=${error.message}`);
        throw error;
    }
}
/**
 * Place take profit order (TAKE_PROFIT_MARKET)
 * Uses specific Algo Order API endpoints when positionSide is set (hedge mode)
 */
async function placeTakeProfitOrder(_client, symbol, side, quantity, price, intent, currentPosition = null, positionSide = null) {
    // Validate intent is provided
    if (!intent) {
        throw new Error('[BinanceClient] Order rejected: intent is required (OPEN or CLOSE)');
    }
    // Validate currentPosition is provided for CLOSE orders
    if (intent === 'CLOSE' && !currentPosition) {
        throw new Error('[BinanceClient] Order rejected: currentPosition is required for CLOSE orders');
    }
    try {
        await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
        // Get precision filters and normalize values
        const filters = await getSymbolFilters(symbol);
        const qtyCheck = (0, order_quantity_1.evaluateNormalizedQuantity)(quantity, filters);
        const normalizedQuantity = assertValidNormalizedQuantity(symbol, intent, qtyCheck);
        const normalizedPrice = normalizeToTickSize(price, filters.tickSize);
        console.log(`[BinanceClient] Precision normalization for TP: quantity ${quantity} -> ${normalizedQuantity}, price ${price} -> ${normalizedPrice}`);
        // Log order details before placing
        console.log(`[BinanceClient] TAKE PROFIT ORDER REQUEST: symbol=${symbol} side=${side} intent=${intent} quantity=${quantity} price=${price} positionSide=${positionSide || 'N/A'} currentPosition=${currentPosition ? JSON.stringify(currentPosition) : 'N/A'}`);
        // If positionSide is explicitly provided, validate it
        if (positionSide !== null) {
            (0, binance_hedge_mode_1.validatePositionSide)(positionSide);
        }
        else {
            // Resolve positionSide based on side, intent, and current position
            positionSide = (0, binance_hedge_mode_1.resolvePositionSide)(side, intent, currentPosition);
        }
        const params = {
            symbol,
            side,
            quantity: normalizedQuantity.toString(),
            stopPrice: normalizedPrice.toString(),
        };
        // Add positionSide for hedge mode (dual position side)
        if (positionSide) {
            params.positionSide = positionSide;
            params.closePosition = true; // Close position when triggered
            const response = await (0, trading_2.placeTakeProfitMarketOrder)(params);
            console.log(`[BinanceClient] TAKE PROFIT ORDER PLACED: symbol=${symbol} side=${side} intent=${intent} positionSide=${positionSide} type=TAKE_PROFIT_MARKET price=${normalizedPrice} orderId=${response.orderId || response.algoId}`);
            return response;
        }
        else {
            const response = await (0, trading_2.placeTakeProfitMarketOrder)({
                symbol,
                side,
                quantity: params.quantity,
                stopPrice: params.stopPrice,
                reduceOnly: true,
            });
            console.log(`[BinanceClient] TAKE PROFIT ORDER PLACED: symbol=${symbol} side=${side} intent=${intent} ` +
                `type=TAKE_PROFIT_MARKET (algo) price=${normalizedPrice} orderId=${response.orderId || response.algoId}`);
            return response;
        }
    }
    catch (error) {
        console.error(`[BinanceClient] TAKE PROFIT ORDER FAILED: symbol=${symbol} side=${side} intent=${intent} error=${error.message}`);
        throw error;
    }
}
/**
 * Cancel order by ID
 */
async function cancelOrder(_client, symbol, orderId) {
    try {
        const response = await (0, trading_1.cancelOrder)(symbol, orderId);
        console.log(`[BinanceClient] Order cancelled: ${orderId} for ${symbol}`);
        return response;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to cancel order:', error.message);
        throw error;
    }
}
/**
 * Cancel all orders for a symbol
 */
async function cancelAllOrders(_client, symbol) {
    try {
        const response = await (0, trading_1.cancelAllOrders)(symbol);
        console.log(`[BinanceClient] All orders cancelled for ${symbol}`);
        return response;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to cancel all orders:', error.message);
        throw error;
    }
}
/**
 * Cancel an algo order by ID
 */
async function cancelAlgoOrder(_client, symbol, algoId, clientAlgoId = null) {
    try {
        const response = await (0, trading_2.cancelAlgoOrder)(symbol, algoId, clientAlgoId);
        console.log(`[BinanceClient] Algo order cancelled: ${algoId || clientAlgoId} for ${symbol}`);
        return response;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to cancel algo order:', error.message);
        throw error;
    }
}
/**
 * Cancel all algo orders for a symbol
 */
async function cancelAllAlgoOrders(_client, symbol) {
    try {
        const response = await (0, trading_2.cancelAllAlgoOrders)(symbol);
        console.log(`[BinanceClient] All algo orders cancelled for ${symbol}`);
        return response;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to cancel all algo orders:', error.message);
        throw error;
    }
}
/**
 * Get open orders for a symbol
 */
async function getOpenOrders(_client, symbol) {
    try {
        const orders = await (0, trading_1.getOpenOrders)(symbol);
        return orders;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to get open orders:', error.message);
        throw error;
    }
}
/**
 * Get open algo orders for a symbol (STOP_MARKET, TAKE_PROFIT_MARKET)
 */
async function getOpenAlgoOrders(_client, symbol) {
    try {
        const orders = await (0, trading_2.getOpenAlgoOrders)(symbol);
        return orders;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to get open algo orders:', error.message);
        throw error;
    }
}
/**
 * Get position risk information
 */
async function getPositionRisk(_client, symbol) {
    try {
        const positions = await (0, account_2.getPositionRisk)(symbol);
        return positions;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to get position risk:', error.message);
        throw error;
    }
}
/**
 * Set leverage for a symbol
 */
async function setLeverage(_client, symbol, leverage) {
    try {
        const response = await (0, trading_2.setLeverage)(symbol, leverage);
        console.log(`[BinanceClient] Leverage set to ${leverage}x for ${symbol}`);
        return response;
    }
    catch (error) {
        console.error('[BinanceClient] Failed to set leverage:', error.message);
        throw error;
    }
}
/**
 * Set margin type (ISOLATED or CROSSED)
 */
async function setMarginType(_client, symbol, marginType) {
    try {
        const response = await (0, trading_2.setMarginType)(symbol, marginType);
        console.log(`[BinanceClient] Margin type set to ${marginType} for ${symbol}`);
        return response;
    }
    catch (error) {
        // Ignore "No need to change margin type" error - it means margin type is already correct
        if (error.message.includes('No need to change margin type')) {
            console.log(`[BinanceClient] Margin type already set to ${marginType} for ${symbol}`);
            return { symbol, marginType };
        }
        console.error('[BinanceClient] Failed to set margin type:', error.message);
        throw error;
    }
}
//# sourceMappingURL=binanceClient.js.map