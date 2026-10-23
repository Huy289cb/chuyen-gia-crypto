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
const app_1 = require("./app");
const app_2 = require("./config/app");
const app_3 = require("./config/app");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: require('path').resolve(__dirname, '../.env') });
/**
 * API Server Entry Point
 *
 * This file starts the HTTP server for the API process.
 * It never starts scheduler jobs - those run only in the worker process.
 */
async function startServer() {
    console.log('[Server] Starting API server...');
    // Validate configuration
    try {
        (0, app_3.validateAppConfig)();
    }
    catch (error) {
        console.error('[Server] Configuration validation failed:', error.message);
        process.exit(1);
    }
    // Validate safety requirements per Big Update Plan v3
    try {
        (0, app_3.validateSafetyRequirements)();
    }
    catch (error) {
        console.error('[Server] Safety validation failed:', error.message);
        process.exit(1);
    }
    // Ensure this is the API process
    if (!(0, app_2.isApiProcess)()) {
        console.error('[Server] Cannot start API server when WORKER_ONLY is true');
        process.exit(1);
    }
    // Create Express app
    const app = (0, app_1.createApp)();
    // Start HTTP server
    const server = app.listen(app_2.appConfig.port, '0.0.0.0', () => {
        console.log('=================================');
        console.log('  Crypto Analyzer API Server');
        console.log('=================================');
        console.log(`Environment: ${app_2.appConfig.nodeEnv}`);
        console.log(`Port: ${app_2.appConfig.port}`);
        console.log(`Process Type: API`);
        console.log(`Database: ${app_2.appConfig.databaseUrl ? 'configured' : 'NOT CONFIGURED'}`);
        console.log('');
        console.log('Health check: http://localhost:' + app_2.appConfig.port + '/health');
        console.log('=================================');
        // Binance user stream + reconciliation run on worker (see binance-runtime-bootstrap).
        if (process.env.BINANCE_ENABLED === 'true' &&
            process.env.BINANCE_USER_STREAM_ON_WORKER === 'false') {
            console.log('[Server] Legacy mode: Binance WS/reconciliation on API process');
            Promise.resolve().then(() => __importStar(require('./services/binance-websocket-sync'))).then(({ startBinanceWebSocketSync }) => {
                startBinanceWebSocketSync().catch((error) => {
                    console.error('[Server] Failed to start Binance WebSocket sync:', error);
                });
            });
            Promise.resolve().then(() => __importStar(require('./services/binance-reconciliation'))).then(({ initializeBinanceReconciliation }) => {
                initializeBinanceReconciliation().catch((error) => {
                    console.error('[Server] Failed to initialize Binance reconciliation:', error);
                });
            });
            Promise.resolve().then(() => __importStar(require('./services/binance-hedge-mode'))).then(({ initializeHedgeModeDetection }) => {
                initializeHedgeModeDetection().catch((error) => {
                    console.error('[Server] Failed to initialize hedge mode detection:', error);
                });
            });
        }
    });
    // Handle server errors
    server.on('error', (error) => {
        if (error.syscall !== 'listen') {
            throw error;
        }
        const bind = typeof app_2.appConfig.port === 'string'
            ? 'Pipe ' + app_2.appConfig.port
            : 'Port ' + app_2.appConfig.port;
        switch (error.code) {
            case 'EACCES':
                console.error(`[Server] ${bind} requires elevated privileges`);
                process.exit(1);
                break;
            case 'EADDRINUSE':
                console.error(`[Server] ${bind} is already in use`);
                process.exit(1);
                break;
            default:
                throw error;
        }
    });
    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
        console.log(`[Server] ${signal} received. Shutting down gracefully...`);
        // Stop Binance WebSocket sync if enabled
        if (process.env.BINANCE_ENABLED === 'true') {
            try {
                const { stopBinanceWebSocketSync } = await Promise.resolve().then(() => __importStar(require('./services/binance-websocket-sync')));
                await stopBinanceWebSocketSync();
                console.log('[Server] Binance WebSocket sync stopped');
            }
            catch (error) {
                console.error('[Server] Error stopping Binance WebSocket sync:', error);
            }
            try {
                const { stopPeriodicReconciliation } = await Promise.resolve().then(() => __importStar(require('./services/binance-reconciliation')));
                stopPeriodicReconciliation();
                console.log('[Server] Periodic reconciliation stopped');
            }
            catch (error) {
                console.error('[Server] Error stopping periodic reconciliation:', error);
            }
        }
        server.close(async () => {
            console.log('[Server] HTTP server closed');
            const { disconnectPrisma } = await Promise.resolve().then(() => __importStar(require('./lib/prisma')));
            await disconnectPrisma();
            console.log('[Server] Prisma client disconnected');
            process.exit(0);
        });
        // Force shutdown after 10 seconds
        setTimeout(() => {
            console.error('[Server] Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
// Start the server
startServer().catch((error) => {
    console.error('[Server] Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map