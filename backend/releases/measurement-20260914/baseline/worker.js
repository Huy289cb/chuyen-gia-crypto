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
const app_1 = require("./config/app");
const app_2 = require("./config/app");
const prisma_1 = require("./lib/prisma");
const worker_scheduler_1 = require("./services/worker-scheduler");
const telegram_bot_service_1 = require("./services/telegram/telegram-bot.service");
const telegram_daily_report_scheduler_1 = require("./schedulers/telegram-daily-report.scheduler");
const telegram_1 = require("./config/telegram");
const groq_levels_adapter_service_1 = require("./services/groq-levels-adapter.service");
const testnet_repository_1 = require("./repositories/testnet.repository");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: require('path').resolve(__dirname, '../.env') });
/**
 * Worker Process Entry Point
 *
 * This file starts the worker process which handles:
 * - Scheduler execution
 * - Price sync tasks
 * - Testnet sync tasks
 * - Background maintenance tasks
 *
 * The worker acquires a leader lock before any scheduled execution.
 * It never exposes a public HTTP port.
 */
// Leader lock implementation using PostgreSQL advisory locks
async function acquireLeaderLock() {
    try {
        const { prisma } = await Promise.resolve().then(() => __importStar(require('./lib/prisma')));
        // Use PostgreSQL advisory lock
        // This is a session-level lock that automatically releases on disconnect
        const result = await prisma.$queryRaw `
      SELECT pg_try_advisory_lock(${app_1.appConfig.workerLeaderLockKey}) as acquired
    `;
        const acquired = result[0]?.acquired || false;
        if (acquired) {
            console.log(`[Worker] Leader lock acquired (key: ${app_1.appConfig.workerLeaderLockKey})`);
        }
        else {
            console.log(`[Worker] Failed to acquire leader lock (key: ${app_1.appConfig.workerLeaderLockKey})`);
            console.log('[Worker] Another worker instance may be running');
        }
        return acquired;
    }
    catch (error) {
        console.error('[Worker] Error acquiring leader lock:', error);
        return false;
    }
}
async function releaseLeaderLock() {
    try {
        const { prisma } = await Promise.resolve().then(() => __importStar(require('./lib/prisma')));
        await prisma.$queryRaw `
      SELECT pg_advisory_unlock(${app_1.appConfig.workerLeaderLockKey})
    `;
        console.log(`[Worker] Leader lock released (key: ${app_1.appConfig.workerLeaderLockKey})`);
    }
    catch (error) {
        console.error('[Worker] Error releasing leader lock:', error);
    }
}
async function startWorker() {
    console.log('[Worker] Starting worker process...');
    const { markWorkerStarted } = await Promise.resolve().then(() => __importStar(require('./services/position-lifecycle-guard.service')));
    markWorkerStarted();
    // Validate configuration
    try {
        (0, app_2.validateAppConfig)();
    }
    catch (error) {
        console.error('[Worker] Configuration validation failed:', error.message);
        process.exit(1);
    }
    // Validate safety requirements per Big Update Plan v3
    try {
        (0, app_2.validateSafetyRequirements)();
    }
    catch (error) {
        console.error('[Worker] Safety validation failed:', error.message);
        process.exit(1);
    }
    // Ensure this is the worker process
    if (!(0, app_1.isWorkerProcess)()) {
        console.error('[Worker] Cannot start worker when API_ONLY is true');
        process.exit(1);
    }
    if (!app_1.appConfig.databaseUrl) {
        console.error('[Worker] DATABASE_URL is required to run worker jobs');
        process.exit(1);
    }
    // Acquire leader lock
    const lockAcquired = await acquireLeaderLock();
    if (!lockAcquired) {
        console.error('[Worker] Exiting - could not acquire leader lock');
        process.exit(1);
    }
    console.log('=================================');
    console.log('  Crypto Analyzer Worker');
    console.log('=================================');
    console.log(`Environment: ${app_1.appConfig.nodeEnv}`);
    console.log(`Process Type: Worker`);
    console.log(`Leader Lock Key: ${app_1.appConfig.workerLeaderLockKey}`);
    console.log(`Database: ${app_1.appConfig.databaseUrl ? 'configured' : 'NOT CONFIGURED'}`);
    console.log(`Levels adapter (${process.env.LEVELS_ADAPTER_PROVIDER || 'groq'}): ${(0, groq_levels_adapter_service_1.isLevelsAdapterConfigured)() ? 'ENABLED' : 'disabled'}`);
    console.log('=================================');
    // Initialize main testnet account for end-to-end pipeline
    try {
        console.log('[Worker] Initializing default testnet account...');
        await (0, testnet_repository_1.getOrCreateTestnetAccount)('BTC', 'kim_nghia', 10000);
        console.log('[Worker] Testnet account BTC/kim_nghia initialized successfully');
    }
    catch (err) {
        console.error('[Worker] Failed to initialize default testnet account:', err.message);
    }
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            const { bootstrapBinanceOnWorker } = await Promise.resolve().then(() => __importStar(require('./services/binance-runtime-bootstrap')));
            await bootstrapBinanceOnWorker();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[Worker] Failed to bootstrap Binance runtime:', message);
        }
    }
    const { backfillOhlcvIfNeeded, isOhlcvBackfillOnStartEnabled, } = await Promise.resolve().then(() => __importStar(require('./services/ohlcv-backfill.service')));
    if (isOhlcvBackfillOnStartEnabled()) {
        void backfillOhlcvIfNeeded('BTC')
            .then((result) => {
            const summary = result.timeframes
                .map((t) => `${t.timeframe}:${t.before}→${t.after}${t.skipped ? '(skip)' : ''}`)
                .join(' ');
            console.log(`[Worker] OHLCV backfill complete — ${summary}`);
        })
            .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Worker] OHLCV backfill failed (non-fatal): ${msg}`);
        });
    }
    // Start scheduler
    await (0, worker_scheduler_1.startWorkerScheduler)();
    if ((0, telegram_1.isTelegramEnabled)()) {
        (0, telegram_1.logTelegramProcessContext)('crypto-worker');
        (0, telegram_daily_report_scheduler_1.startTelegramDailyReportScheduler)();
        (0, telegram_bot_service_1.startTelegramBot)();
    }
    // Keep the process alive
    console.log('[Worker] Worker is running. Press Ctrl+C to stop.');
}
// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`[Worker] ${signal} received. Shutting down gracefully...`);
    (0, worker_scheduler_1.stopWorkerScheduler)();
    (0, telegram_daily_report_scheduler_1.stopTelegramDailyReportScheduler)();
    (0, telegram_bot_service_1.stopTelegramBot)();
    try {
        const { shutdownBinanceRuntime } = await Promise.resolve().then(() => __importStar(require('./services/binance-runtime-bootstrap')));
        await shutdownBinanceRuntime();
    }
    catch {
        /* non-fatal */
    }
    // Release leader lock
    await releaseLeaderLock();
    // Disconnect Prisma
    await (0, prisma_1.disconnectPrisma)();
    console.log('[Worker] Prisma client disconnected');
    console.log('[Worker] Worker shutdown complete');
    process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Worker] Uncaught exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
    console.error('[Worker] Unhandled rejection:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});
// Start the worker
startWorker().catch((error) => {
    console.error('[Worker] Failed to start worker:', error);
    process.exit(1);
});
//# sourceMappingURL=worker.js.map