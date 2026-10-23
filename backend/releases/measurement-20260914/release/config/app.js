"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appConfig = void 0;
exports.validateAppConfig = validateAppConfig;
exports.validateSafetyRequirements = validateSafetyRequirements;
exports.isApiProcess = isApiProcess;
exports.isWorkerProcess = isWorkerProcess;
exports.isProduction = isProduction;
exports.isDevelopment = isDevelopment;
const node_cron_1 = __importDefault(require("node-cron"));
const telegram_1 = require("./telegram");
const telegram_ai_1 = require("./telegram-ai");
exports.appConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    databaseUrl: process.env.DATABASE_URL || '',
    directUrl: process.env.DIRECT_URL,
    apiOnly: process.env.API_ONLY === 'true',
    workerOnly: process.env.WORKER_ONLY === 'true',
    workerLeaderLockKey: parseInt(process.env.WORKER_LEADER_LOCK_KEY || '12345', 10),
    priceUpdateIntervalMs: parseInt(process.env.PRICE_UPDATE_INTERVAL_MS || '30000', 10),
    predictionValidationCron: process.env.PREDICTION_VALIDATION_CRON || '0 * * * *',
    dailyMaintenanceCron: process.env.DAILY_MAINTENANCE_CRON || '0 3 * * *',
    snapshotCron: process.env.SNAPSHOT_CRON || '*/15 * * * *',
    analysisCronSchedule: process.env.CRON_SCHEDULE || '*/15 * * * *',
    retentionDaysPriceHistory: parseInt(process.env.RETENTION_DAYS_PRICE_HISTORY || '30', 10),
    retentionDaysOhlcv: parseInt(process.env.RETENTION_DAYS_OHLCV || '90', 10),
};
/**
 * Validate required configuration
 */
function validateAppConfig() {
    if (process.env.NODE_ENV === 'production') {
        const required = ['DATABASE_URL'];
        for (const envVar of required) {
            if (!process.env[envVar]) {
                throw new Error(`${envVar} is required in production`);
            }
        }
    }
    const errors = [];
    // Only require DATABASE_URL in production
    if (process.env.NODE_ENV === 'production' && !exports.appConfig.databaseUrl) {
        errors.push('DATABASE_URL is required in production');
    }
    if (exports.appConfig.apiOnly && exports.appConfig.workerOnly) {
        errors.push('Cannot set both API_ONLY and WORKER_ONLY to true');
    }
    if (!Number.isFinite(exports.appConfig.priceUpdateIntervalMs) || exports.appConfig.priceUpdateIntervalMs < 5000) {
        errors.push('PRICE_UPDATE_INTERVAL_MS must be a number >= 5000');
    }
    if (!node_cron_1.default.validate(exports.appConfig.predictionValidationCron)) {
        errors.push('PREDICTION_VALIDATION_CRON is invalid');
    }
    if (!node_cron_1.default.validate(exports.appConfig.dailyMaintenanceCron)) {
        errors.push('DAILY_MAINTENANCE_CRON is invalid');
    }
    if (!node_cron_1.default.validate(exports.appConfig.snapshotCron)) {
        errors.push('SNAPSHOT_CRON is invalid');
    }
    if (!node_cron_1.default.validate(exports.appConfig.analysisCronSchedule)) {
        errors.push('CRON_SCHEDULE is invalid');
    }
    if (!Number.isFinite(exports.appConfig.retentionDaysPriceHistory) || exports.appConfig.retentionDaysPriceHistory < 1) {
        errors.push('RETENTION_DAYS_PRICE_HISTORY must be a number >= 1');
    }
    if (!Number.isFinite(exports.appConfig.retentionDaysOhlcv) || exports.appConfig.retentionDaysOhlcv < 1) {
        errors.push('RETENTION_DAYS_OHLCV must be a number >= 1');
    }
    if (errors.length > 0) {
        throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }
    (0, telegram_1.validateTelegramConfig)();
    (0, telegram_ai_1.validateTelegramAiConfig)();
    (0, telegram_ai_1.validateCursorAgentConfig)();
}
/**
 * Validate safety requirements per Big Update Plan v3
 * This ensures critical safety features cannot be disabled
 */
function validateSafetyRequirements() {
    const errors = [];
    // Import method config to check BTC-only scope
    try {
        const { METHODS } = require('./methods');
        const enabledMethods = Object.values(METHODS).filter((m) => m.enabled);
        for (const method of enabledMethods) {
            const methodConfig = method;
            const symbols = methodConfig.autoEntry?.enabledSymbols || [];
            // Check for ETH in enabled symbols (violates BTC-only requirement)
            if (symbols.includes('ETH')) {
                errors.push(`Method ${methodConfig.methodId} has ETH in enabledSymbols - violates BTC-only requirement per Big Update Plan v3`);
            }
            // Ensure BTC is in enabled symbols
            if (!symbols.includes('BTC')) {
                errors.push(`Method ${methodConfig.methodId} does not have BTC in enabledSymbols - BTC is required per Big Update Plan v3`);
            }
        }
    }
    catch (error) {
        console.warn('[SafetyValidation] Could not validate method configuration:', error);
    }
    // Check that safety features cannot be disabled via environment
    // These are hardcoded in groq-dispatch.service.ts, but we validate intent
    const unsafeConfigs = [
        'DISABLE_SIGNAL_GATE',
        'DISABLE_RISK_CHECK',
        'DISABLE_MEMORY_LAYER'
    ];
    for (const config of unsafeConfigs) {
        if (process.env[config] === 'true') {
            errors.push(`Environment variable ${config} is set to true - critical safety features cannot be disabled per Big Update Plan v3`);
        }
    }
    try {
        const { validateMainnetSafetyRequirements } = require('./mainnet-safety');
        errors.push(...validateMainnetSafetyRequirements());
    }
    catch (error) {
        console.warn('[SafetyValidation] Could not validate mainnet safety configuration:', error);
    }
    if (errors.length > 0) {
        throw new Error(`Safety validation failed: ${errors.join(', ')}`);
    }
    console.log('[SafetyValidation] All safety requirements validated successfully');
}
/**
 * Check if this is the API process
 */
function isApiProcess() {
    return exports.appConfig.workerOnly === false;
}
/**
 * Check if this is the worker process
 */
function isWorkerProcess() {
    return exports.appConfig.apiOnly === false;
}
/**
 * Check if running in production
 */
function isProduction() {
    return exports.appConfig.nodeEnv === 'production';
}
/**
 * Check if running in development
 */
function isDevelopment() {
    return exports.appConfig.nodeEnv === 'development';
}
//# sourceMappingURL=app.js.map