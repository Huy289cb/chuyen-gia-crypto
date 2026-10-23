"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workerConfig = void 0;
exports.validateWorkerConfig = validateWorkerConfig;
function parseSymbols(value) {
    const raw = (value || 'BTC,ETH')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    return raw.length > 0 ? Array.from(new Set(raw)) : ['BTC', 'ETH'];
}
exports.workerConfig = {
    // Reuse ENABLED_SYMBOLS so API/worker stay aligned by default.
    syncSymbols: parseSymbols(process.env.ENABLED_SYMBOLS),
    ohlcvTimeframe: process.env.WORKER_OHLCV_TIMEFRAME || '1m',
    enableTestnetSync: process.env.WORKER_ENABLE_TESTNET_SYNC !== 'false',
};
function validateWorkerConfig() {
    if (exports.workerConfig.syncSymbols.length === 0) {
        throw new Error('ENABLED_SYMBOLS must contain at least one symbol');
    }
    if (!exports.workerConfig.ohlcvTimeframe.trim()) {
        throw new Error('WORKER_OHLCV_TIMEFRAME must not be empty');
    }
}
//# sourceMappingURL=worker.js.map