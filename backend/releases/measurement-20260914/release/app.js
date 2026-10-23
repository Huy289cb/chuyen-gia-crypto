"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = require("./config/cors");
const index_1 = __importDefault(require("./routes/index"));
/**
 * Create Express app with middleware and routes
 */
function createApp() {
    const app = (0, express_1.default)();
    // Trust proxy for rate limiting behind reverse proxy
    app.set('trust proxy', 1);
    // Middleware
    app.use(cors_1.corsMiddleware);
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    // Health check endpoint
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });
    // API routes
    app.use('/api', index_1.default);
    // Root endpoint
    app.get('/', (_req, res) => {
        res.json({
            name: 'Crypto Analyzer API (TypeScript)',
            version: '2.0.0',
            status: 'running',
            endpoints: {
                '/api/health': 'Health check',
                '/api/prices': 'Get latest prices',
                '/api/analysis': 'Get recent analysis',
                '/api/latest-price/:coin': 'Get latest price for specific coin'
            }
        });
    });
    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            error: 'Not found',
            path: req.path
        });
    });
    // Global error handler
    app.use((err, _req, res, _next) => {
        console.error('[App] Error:', err.message);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    });
    return app;
}
//# sourceMappingURL=app.js.map