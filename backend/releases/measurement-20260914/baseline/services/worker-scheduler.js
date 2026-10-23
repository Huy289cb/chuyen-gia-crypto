"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorkerScheduler = startWorkerScheduler;
exports.stopWorkerScheduler = stopWorkerScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const app_1 = require("../config/app");
const worker_1 = require("../config/worker");
const analysis_repository_1 = require("../repositories/analysis.repository");
const market_repository_1 = require("../repositories/market.repository");
const runtime_maintenance_1 = require("./runtime-maintenance");
const testnet_sync_1 = require("./testnet-sync");
const price_fetcher_1 = require("./price-fetcher");
// CRITICAL: Legacy kim_nghia auto-entry DISABLED per Big Update v3
// import { runKimNghiaAnalysisJob } from './kim-nghia-analysis-job';
const market_scan_scheduler_1 = require("../schedulers/market-scan.scheduler");
const llm_dispatch_scheduler_1 = require("../schedulers/llm-dispatch.scheduler");
const v3_schedulers_1 = require("../config/v3-schedulers");
const position_monitor_scheduler_1 = require("../schedulers/position-monitor.scheduler");
const pending_order_scheduler_1 = require("../schedulers/pending-order.scheduler");
const binance_balance_sync_service_1 = require("./binance-balance-sync.service");
const protective_exposure_audit_service_1 = require("./protective-exposure-audit.service");
const position_lifecycle_guard_service_1 = require("./position-lifecycle-guard.service");
let priceSyncInterval = null;
let protectiveAuditInterval = null;
let protectiveAuditStartupTimer = null;
const cronTasks = [];
let priceSyncJobRunning = false;
const priceHistoryIntervalMs = parseInt(process.env.PRICE_HISTORY_INTERVAL_MS || '300000', 10);
const lastPriceHistoryAt = new Map();
const lastTickerPrice = new Map();
function protectiveAuditIntervalMs() {
    const raw = parseInt(process.env.PROTECTIVE_EXPOSURE_AUDIT_INTERVAL_MS || '60000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 60000;
}
async function runPriceSyncJob() {
    if (priceSyncJobRunning) {
        console.warn('[WorkerScheduler] Previous price sync still running, skipping cycle');
        return;
    }
    priceSyncJobRunning = true;
    try {
        const prices = await (0, price_fetcher_1.fetchRealTimePrices)();
        const symbolToCandle = {
            BTC: prices.btc,
            ETH: prices.eth,
        };
        const updates = [];
        for (const symbol of worker_1.workerConfig.syncSymbols) {
            const candle = symbolToCandle[symbol];
            if (!candle) {
                continue;
            }
            updates.push({ coin: symbol, price: candle.price, volume: candle.volume });
        }
        if (updates.length === 0) {
            console.warn(`[WorkerScheduler] No matching symbols to sync. configured=${worker_1.workerConfig.syncSymbols.join(',')}`);
            return;
        }
        for (const item of updates) {
            const prevPrice = lastTickerPrice.get(item.coin);
            const priceMoved = prevPrice == null ||
                Math.abs(item.price - prevPrice) / Math.max(Math.abs(prevPrice), 1e-9) >= 0.0001;
            lastTickerPrice.set(item.coin, item.price);
            if (priceMoved) {
                await (0, market_repository_1.saveLatestPrice)({
                    coin: item.coin,
                    price: item.price,
                    volume24h: item.volume,
                });
            }
            const lastHist = lastPriceHistoryAt.get(item.coin) ?? 0;
            if (Date.now() - lastHist >= priceHistoryIntervalMs) {
                await (0, market_repository_1.savePriceHistory)(item.coin, item.price);
                lastPriceHistoryAt.set(item.coin, Date.now());
            }
            const candle = symbolToCandle[item.coin];
            if (worker_1.workerConfig.enableTestnetSync && candle) {
                await (0, testnet_sync_1.syncTestnetForSymbol)(item.coin, candle);
            }
        }
        console.log(`[WorkerScheduler] Price sync completed for ${updates.map((u) => u.coin).join(', ')}`);
    }
    catch (error) {
        console.error('[WorkerScheduler] Price sync job failed:', error);
    }
    finally {
        priceSyncJobRunning = false;
    }
}
async function runPredictionValidationJob() {
    try {
        const validatedCount = await (0, analysis_repository_1.validatePredictions)();
        console.log(`[WorkerScheduler] Prediction validation completed. Updated ${validatedCount} expired prediction(s).`);
    }
    catch (error) {
        console.error('[WorkerScheduler] Prediction validation job failed:', error);
    }
}
async function runSnapshotJob() {
    try {
        await (0, runtime_maintenance_1.createTradingSnapshots)();
        console.log('[WorkerScheduler] Snapshot job completed');
    }
    catch (error) {
        console.error('[WorkerScheduler] Snapshot job failed:', error);
    }
}
async function runMaintenanceJob() {
    try {
        const result = await (0, runtime_maintenance_1.runDataRetention)(app_1.appConfig.retentionDaysPriceHistory, app_1.appConfig.retentionDaysOhlcv);
        console.log(`[WorkerScheduler] Maintenance completed. deleted price_history=${result.priceHistoryDeleted}, ohlcv=${result.ohlcvDeleted}`);
    }
    catch (error) {
        console.error('[WorkerScheduler] Maintenance job failed:', error);
    }
}
async function startWorkerScheduler() {
    console.log('[WorkerScheduler] Starting scheduler...');
    (0, worker_1.validateWorkerConfig)();
    // Prime initial data so API can immediately serve fresh prices.
    await runPriceSyncJob();
    priceSyncInterval = setInterval(() => {
        void runPriceSyncJob();
    }, app_1.appConfig.priceUpdateIntervalMs);
    const validationTask = node_cron_1.default.schedule(app_1.appConfig.predictionValidationCron, () => {
        void runPredictionValidationJob();
    });
    cronTasks.push(validationTask);
    const snapshotTask = node_cron_1.default.schedule(app_1.appConfig.snapshotCron, () => {
        void runSnapshotJob();
    });
    cronTasks.push(snapshotTask);
    const maintenanceTask = node_cron_1.default.schedule(app_1.appConfig.dailyMaintenanceCron, () => {
        void runMaintenanceJob();
    });
    cronTasks.push(maintenanceTask);
    // CRITICAL: Legacy kim_nghia analysis cron task DISABLED per Big Update v3
    // const analysisTask = cron.schedule(appConfig.analysisCronSchedule, () => {
    //   void runKimNghiaCronJob();
    // });
    // cronTasks.push(analysisTask);
    // Start new Big Update v3 schedulers
    console.log('[WorkerScheduler] Starting Big Update v3 schedulers...');
    // Market scan scheduler - runs every 5 minutes
    (0, market_scan_scheduler_1.startMarketScanScheduler)(v3_schedulers_1.V3_MARKET_SCAN_CRON);
    // LLM dispatch — offset +2 min after market scan boundaries
    (0, llm_dispatch_scheduler_1.startLLMDispatchScheduler)(v3_schedulers_1.V3_LLM_DISPATCH_CRON);
    // Position monitor scheduler - runs every minute
    (0, position_monitor_scheduler_1.startPositionMonitorScheduler)('*/1 * * * *');
    // Pending limit TTL / drift — every 5 min (also runs at start of LLM dispatch)
    (0, pending_order_scheduler_1.startPendingOrderScheduler)();
    // Exchange wallet/income sync must remain active when legacy simulated fills are disabled.
    if (process.env.BINANCE_ENABLED === 'true') {
        const balanceSyncTask = node_cron_1.default.schedule('*/5 * * * *', () => {
            void (0, binance_balance_sync_service_1.syncAllTestnetAccountsFromBinance)();
        });
        cronTasks.push(balanceSyncTask);
        void (0, binance_balance_sync_service_1.syncAllTestnetAccountsFromBinance)();
    }
    if (process.env.BINANCE_ENABLED === 'true' && process.env.PROTECTIVE_EXPOSURE_AUDIT_ENABLED !== 'false') {
        const intervalMs = protectiveAuditIntervalMs();
        const startupDelayMs = (0, position_lifecycle_guard_service_1.protectiveAuditStartupDelayMs)();
        const runAudit = () => {
            void (0, protective_exposure_audit_service_1.auditProtectiveCoverageForSymbols)(worker_1.workerConfig.syncSymbols);
        };
        protectiveAuditStartupTimer = setTimeout(() => {
            protectiveAuditStartupTimer = null;
            runAudit();
            protectiveAuditInterval = setInterval(runAudit, intervalMs);
        }, startupDelayMs);
        console.log(`[WorkerScheduler] Protective exposure audit scheduled interval=${intervalMs}ms startupDelay=${startupDelayMs}ms`);
    }
    console.log(`[WorkerScheduler] Started. symbols=${worker_1.workerConfig.syncSymbols.join(',')} timeframe=${worker_1.workerConfig.ohlcvTimeframe} testnetSync=${worker_1.workerConfig.enableTestnetSync} priceInterval=${app_1.appConfig.priceUpdateIntervalMs}ms validationCron="${app_1.appConfig.predictionValidationCron}" snapshotCron="${app_1.appConfig.snapshotCron}" maintenanceCron="${app_1.appConfig.dailyMaintenanceCron}" analysisCron="${app_1.appConfig.analysisCronSchedule}"`);
}
function stopWorkerScheduler() {
    if (priceSyncInterval) {
        clearInterval(priceSyncInterval);
        priceSyncInterval = null;
    }
    if (protectiveAuditStartupTimer) {
        clearTimeout(protectiveAuditStartupTimer);
        protectiveAuditStartupTimer = null;
    }
    if (protectiveAuditInterval) {
        clearInterval(protectiveAuditInterval);
        protectiveAuditInterval = null;
    }
    for (const task of cronTasks) {
        task.stop();
    }
    cronTasks.length = 0;
    // Stop Big Update v3 schedulers
    // Note: These schedulers have their own stop functions
    // For now, they will be stopped when the process exits
    console.log('[WorkerScheduler] Stopped');
}
//# sourceMappingURL=worker-scheduler.js.map