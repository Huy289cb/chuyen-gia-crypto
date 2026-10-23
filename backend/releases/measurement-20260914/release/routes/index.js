"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const market_repository_1 = require("../repositories/market.repository");
const price_fetcher_1 = require("../services/price-fetcher");
const prisma_1 = require("../lib/prisma");
// Import TypeScript sub-routers
const performance_1 = __importDefault(require("./performance"));
const testnet_1 = __importDefault(require("./testnet"));
const metrics_1 = __importDefault(require("./metrics"));
const dashboard_1 = __importDefault(require("./dashboard"));
const market_1 = __importDefault(require("./market"));
// CRITICAL: Legacy kim_nghia auto-entry DISABLED per Big Update v3
// import { runKimNghiaAnalysisJob } from '../services/kim-nghia-analysis-job';
const router = (0, express_1.Router)();
// Middleware to inject Prisma client into routes
router.use((req, _res, next) => {
    req.prisma = prisma_1.prisma;
    req.dbEnabled = true; // Prisma is always available
    next();
});
// ============================================================================
// TypeScript Endpoints (existing)
// ============================================================================
/**
 * GET /api/health - Health check endpoint
 */
router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
/**
 * GET /api/prices - Get latest prices
 */
router.get('/prices', async (_req, res) => {
    try {
        const prices = await (0, price_fetcher_1.fetchRealTimePrices)();
        res.json(prices);
    }
    catch (error) {
        console.error('[Routes] Error fetching prices:', error.message);
        res.status(500).json({ error: 'Failed to fetch prices' });
    }
});
/**
 * GET /api/analysis - Get latest market data and analysis
 */
router.get('/analysis', async (req, res) => {
    try {
        const methodId = req.query.methodId || 'kim_nghia';
        // Fetch real-time prices
        const prices = await (0, price_fetcher_1.fetchRealTimePrices)();
        // Get latest analysis for BTC and ETH
        const [btcAnalysis, ethAnalysis] = await Promise.all([
            prisma_1.prisma.analysisHistory.findFirst({
                where: { coin: 'BTC', method_id: methodId },
                orderBy: { timestamp: 'desc' },
                include: { predictions: true, key_levels: true },
            }),
            prisma_1.prisma.analysisHistory.findFirst({
                where: { coin: 'ETH', method_id: methodId },
                orderBy: { timestamp: 'desc' },
                include: { predictions: true, key_levels: true },
            }),
        ]);
        // Helper to map DB analysisHistory to frontend Analysis format
        const mapAnalysis = (record) => {
            if (!record)
                return null;
            const predictions = {};
            if (record.predictions) {
                for (const p of record.predictions) {
                    predictions[p.timeframe] = {
                        timeframe: p.timeframe,
                        direction: p.direction,
                        confidence: p.confidence,
                        target: p.target_price,
                        price_target: p.target_price,
                        invalidation_price: record.invalidation_level,
                        reasoning: p.reason_summary,
                    };
                }
            }
            const keyLevels = {};
            if (record.key_levels) {
                for (const k of record.key_levels) {
                    keyLevels[k.level_type] = k.description || '';
                }
            }
            return {
                action: record.action,
                bias: record.bias,
                confidence: record.confidence,
                narrative: record.narrative,
                disclaimer: record.disclaimer,
                suggested_entry: record.suggested_entry,
                stop_loss: record.suggested_stop_loss,
                take_profit: record.suggested_take_profit,
                expected_rr: record.expected_rr,
                invalidation_level: record.invalidation_level,
                predictions,
                key_levels: keyLevels,
            };
        };
        const result = {
            success: true,
            data: {
                prices: {
                    btc: prices.btc,
                    eth: prices.eth,
                    marketData: prices,
                    timestamp: prices.timestamp,
                },
                analysis: {
                    btc: mapAnalysis(btcAnalysis),
                    eth: mapAnalysis(ethAnalysis),
                },
                lastUpdated: prices.timestamp,
            },
        };
        res.json(result);
    }
    catch (error) {
        console.error('[Routes] Error fetching analysis:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch analysis' });
    }
});
/**
 * GET /api/ohlc/:coin - Get OHLC candle data for charts
 */
router.get('/ohlc/:coin', async (req, res) => {
    try {
        const coin = String(req.params.coin);
        const { timeframe = '15m', limit = 100 } = req.query;
        const coinMap = {
            bitcoin: 'BTC',
            btc: 'BTC',
            ethereum: 'ETH',
            eth: 'ETH',
        };
        const coinId = coinMap[coin.toLowerCase()] || coin.toUpperCase();
        // Fetch directly from Binance API
        const { fetchHistoricalCandles } = await Promise.resolve().then(() => __importStar(require('../services/price-fetcher')));
        const rawCandles = await fetchHistoricalCandles(coinId, String(timeframe), parseInt(String(limit), 10));
        const formatted = rawCandles.map((kline) => ({
            time: Math.floor(kline[0] / 1000),
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]),
        }));
        res.json({
            success: true,
            data: formatted,
            meta: { coin: coinId, timeframe, limit: parseInt(String(limit), 10), count: formatted.length },
        });
    }
    catch (error) {
        console.error('[Routes] Error fetching OHLC:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch OHLC data' });
    }
});
/**
 * GET /api/latest-price/:coin - Get latest price for a specific coin
 */
router.get('/latest-price/:coin', async (req, res) => {
    try {
        const coin = req.params.coin.toUpperCase();
        const price = await (0, market_repository_1.getLatestPrice)(coin);
        if (!price) {
            res.status(404).json({ error: 'Price not found' });
            return;
        }
        res.json(price);
    }
    catch (error) {
        console.error('[Routes] Error fetching latest price:', error.message);
        res.status(500).json({ error: 'Failed to fetch latest price' });
    }
});
// ============================================================================
// Additional Endpoints from old routes.js (ported to TypeScript)
// ============================================================================
/**
 * GET /api/predictions/:coin - Get prediction history for a coin with pagination
 */
router.get('/predictions/:coin', async (req, res) => {
    const { coin } = req.params;
    const { limit = 5, page = 1, method } = req.query;
    try {
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = { coin };
        if (method)
            where.method_id = method;
        const [analyses, total] = await Promise.all([
            prisma_1.prisma.analysisHistory.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                take: parseInt(limit),
                skip,
                include: { predictions: true, key_levels: true }
            }),
            prisma_1.prisma.analysisHistory.count({ where })
        ]);
        const limitNum = parseInt(limit, 10);
        const pageNum = parseInt(page, 10);
        res.json({
            success: true,
            data: analyses,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.max(1, Math.ceil(total / limitNum)),
            },
            meta: { coin, limit: limitNum, page: pageNum, method: method || 'ict' }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
/**
 * POST /api/analysis/run - Manual trigger for analysis
 * CRITICAL: DISABLED per Big Update v3 - use new pipeline only
 */
router.post('/analysis/run', async (_req, res) => {
    try {
        console.log('[Routes] Manual analysis trigger requested - DISABLED per Big Update v3');
        res.status(403).json({
            success: false,
            error: 'Legacy analysis trigger DISABLED per Big Update v3. Use new Signal Gate → Risk Engine → Groq pipeline.',
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});
/**
 * GET /api/pending-orders - Get all pending orders
 */
router.get('/pending-orders', async (req, res) => {
    const { symbol, status, method } = req.query;
    const where = {};
    if (symbol)
        where.symbol = symbol;
    if (status)
        where.status = status;
    if (method)
        where.method_id = method;
    try {
        const orders = await prisma_1.prisma.pendingOrder.findMany({
            where,
            orderBy: { created_at: 'desc' }
        });
        res.json({
            success: true,
            data: orders,
            meta: { count: orders.length, filters: { symbol, status, method }, method: method || 'ict' }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
/**
 * GET /api/pending-orders/:id - Get specific pending order
 */
router.get('/pending-orders/:id', async (req, res) => {
    const { id } = req.params;
    const orderId = Array.isArray(id) ? id[0] : id;
    try {
        const order = await prisma_1.prisma.pendingOrder.findUnique({
            where: { id: parseInt(orderId) }
        });
        if (!order) {
            res.status(404).json({
                success: false,
                error: 'Pending order not found'
            });
            return;
        }
        res.json({
            success: true,
            data: order
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
/**
 * POST /api/pending-orders/:id/cancel - Cancel a pending order
 */
router.post('/pending-orders/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const orderId = Array.isArray(id) ? id[0] : id;
    const { reason = 'manual' } = req.body;
    try {
        const order = await prisma_1.prisma.pendingOrder.findUnique({
            where: { id: parseInt(orderId) }
        });
        if (!order) {
            res.status(404).json({
                success: false,
                error: 'Pending order not found or already executed'
            });
            return;
        }
        await prisma_1.prisma.pendingOrder.update({
            where: { id: parseInt(orderId) },
            data: {
                status: 'cancelled',
                close_reason: reason
            }
        });
        res.json({
            success: true,
            message: 'Pending order cancelled successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ============================================================================
// Mount Sub-routers (JavaScript modules)
// ============================================================================
/**
 * Mount performance router
 * Endpoints: GET /api/performance, GET /api/performance/equity-curve, GET /api/performance/trades, etc.
 */
router.use('/performance', performance_1.default);
/**
 * Mount testnet router
 * Endpoints: GET /api/testnet/accounts, GET /api/testnet/positions, etc.
 */
router.use('/testnet', testnet_1.default);
/**
 * Mount metrics router
 * Endpoints: GET /api/metrics/risk, GET /api/metrics/playbooks, GET /api/metrics/no-trade, GET /api/metrics/costs
 */
router.use('/metrics', metrics_1.default);
/**
 * Mount dashboard router
 * Endpoints: GET /api/dashboard/system, GET /api/dashboard/schedulers, GET /api/dashboard/signals, etc.
 * Endpoints: GET /api/account/balance, GET /api/account/positions, GET /api/account/orders, GET /api/account/trades
 */
router.use('/dashboard', dashboard_1.default);
router.use('/account', dashboard_1.default);
/**
 * Mount market router
 * Endpoints: GET /api/market/candles, GET /api/market/indicators, GET /api/market/setups, GET /api/market/signals
 */
router.use('/market', market_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map