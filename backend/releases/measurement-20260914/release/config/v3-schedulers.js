"use strict";
/**
 * Big Update v3 worker cron schedules + signal-gate timeframes (single source of truth).
 * MarketScan runs five seconds after each 5m boundary so Binance has finalized the
 * just-closed kline; LLMDispatch remains +1 min after the boundary.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3_SIGNAL_GATE_TIMEFRAMES = exports.V3_LLM_DISPATCH_CRON = exports.V3_MARKET_SCAN_CRON = void 0;
exports.getV3SignalGateTimeframes = getV3SignalGateTimeframes;
exports.getV3TfPriorityRank = getV3TfPriorityRank;
exports.getV3EntryTfPriorityRank = getV3EntryTfPriorityRank;
exports.getSignalGateCacheTtlMs = getSignalGateCacheTtlMs;
exports.getV3WarmupRequiredCandles = getV3WarmupRequiredCandles;
exports.getV3WarmupTimeframes = getV3WarmupTimeframes;
exports.V3_MARKET_SCAN_CRON = process.env.V3_MARKET_SCAN_CRON?.trim() || '5 */5 * * * *';
/** Default: 1 min after each 5m scan when using 5m stack */
exports.V3_LLM_DISPATCH_CRON = process.env.V3_LLM_DISPATCH_CRON?.trim() ||
    '1,6,11,16,21,26,31,36,41,46,51,56 * * * *';
const V3_VALID_GATE_TIMEFRAMES = ['5m', '15m', '1h', '4h'];
const DEFAULT_SIGNAL_GATE_TIMEFRAMES = ['5m', '15m', '1h'];
/** Active signal-gate timeframes from env (default 5m,15m,1h). */
function getV3SignalGateTimeframes() {
    const raw = process.env.V3_SIGNAL_GATE_TIMEFRAMES?.trim();
    if (!raw) {
        return DEFAULT_SIGNAL_GATE_TIMEFRAMES;
    }
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const filtered = parts.filter((p) => V3_VALID_GATE_TIMEFRAMES.includes(p));
    return filtered.length > 0 ? filtered : DEFAULT_SIGNAL_GATE_TIMEFRAMES;
}
function parseTfOrder(envKey, fallback) {
    const raw = process.env[envKey]?.trim();
    const order = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : [...fallback];
    return order.length > 0 ? order : [...fallback];
}
function buildTfRank(order) {
    const rank = {};
    order.forEach((tf, i) => {
        rank[tf] = i;
    });
    return rank;
}
/** Lower rank = preferred when grade/confidence tie (dashboard display). */
function getV3TfPriorityRank() {
    return buildTfRank(parseTfOrder('V3_TF_PRIORITY', getV3SignalGateTimeframes()));
}
/**
 * LLM entry dispatch priority — default structure-first: 15m → 1h → 5m.
 * When 15m passes gate, prefer it over 5m for Groq/execution.
 */
function getV3EntryTfPriorityRank() {
    const defaultEntry = ['15m', '1h', '5m'];
    const gateTfs = getV3SignalGateTimeframes();
    const preferred = parseTfOrder('V3_ENTRY_TF_PRIORITY', defaultEntry).filter((tf) => gateTfs.includes(tf));
    const rest = gateTfs.filter((tf) => !preferred.includes(tf));
    return buildTfRank([...preferred, ...rest]);
}
/** Duplicate-signal cache TTL — 5m when stack includes 5m. */
function getSignalGateCacheTtlMs() {
    const raw = process.env.SIGNAL_GATE_CACHE_TTL_MS?.trim();
    if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) {
            return n;
        }
    }
    if (getV3SignalGateTimeframes().includes('5m')) {
        return 5 * 60 * 1000;
    }
    return 15 * 60 * 1000;
}
/** OHLCV warmup targets per TF (dashboard + health). */
function getV3WarmupRequiredCandles() {
    return {
        '5m': parseInt(process.env.V3_WARMUP_5M || '2000', 10),
        '15m': parseInt(process.env.V3_WARMUP_15M || '1000', 10),
        '1h': parseInt(process.env.V3_WARMUP_1H || '500', 10),
        '4h': parseInt(process.env.V3_WARMUP_4H || '300', 10),
    };
}
function getV3WarmupTimeframes() {
    return [...getV3SignalGateTimeframes()];
}
/** @deprecated Use getV3SignalGateTimeframes() — kept for type imports */
exports.V3_SIGNAL_GATE_TIMEFRAMES = DEFAULT_SIGNAL_GATE_TIMEFRAMES;
//# sourceMappingURL=v3-schedulers.js.map