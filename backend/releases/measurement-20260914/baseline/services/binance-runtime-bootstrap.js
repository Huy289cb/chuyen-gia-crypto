"use strict";
/**
 * Start Binance user stream + reconciliation on the process that executes trades (worker).
 * Avoids duplicate listen keys when API and worker would both connect.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapBinanceOnWorker = bootstrapBinanceOnWorker;
exports.shutdownBinanceRuntime = shutdownBinanceRuntime;
async function bootstrapBinanceOnWorker() {
    if (process.env.BINANCE_ENABLED !== 'true') {
        return;
    }
    const { initializeHedgeModeDetection } = await Promise.resolve().then(() => __importStar(require('./binance-hedge-mode')));
    await initializeHedgeModeDetection();
    const runUserStream = process.env.BINANCE_USER_STREAM_ON_WORKER !== 'false';
    if (runUserStream) {
        try {
            const { startBinanceWebSocketSync } = await Promise.resolve().then(() => __importStar(require('./binance-websocket-sync')));
            await startBinanceWebSocketSync();
            console.log('[BinanceRuntime] User data stream started on worker');
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn('[BinanceRuntime] User data stream failed (non-fatal, reconciliation will still run):', message);
        }
    }
    const { initializeBinanceReconciliation } = await Promise.resolve().then(() => __importStar(require('./binance-reconciliation')));
    await initializeBinanceReconciliation();
    console.log('[BinanceRuntime] Reconciliation scheduled on worker');
}
async function shutdownBinanceRuntime() {
    if (process.env.BINANCE_ENABLED !== 'true') {
        return;
    }
    try {
        const { stopBinanceWebSocketSync } = await Promise.resolve().then(() => __importStar(require('./binance-websocket-sync')));
        stopBinanceWebSocketSync();
    }
    catch {
        /* optional */
    }
    try {
        const { stopPeriodicReconciliation } = await Promise.resolve().then(() => __importStar(require('./binance-reconciliation')));
        stopPeriodicReconciliation();
    }
    catch {
        /* optional */
    }
}
//# sourceMappingURL=binance-runtime-bootstrap.js.map