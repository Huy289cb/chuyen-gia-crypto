"use strict";
/**
 * Signal Gate Service
 * Determines whether to proceed to LLM analysis based on setup quality
 * Reduces Groq usage by filtering out weak signals before LLM call
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalGateService = exports.SignalGateService = void 0;
const setup_gate_analyzer_1 = require("../analyzers/setup-gate.analyzer");
const risk_policy_1 = require("../config/risk-policy");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const v3_schedulers_1 = require("../config/v3-schedulers");
const v3_regime_policy_1 = require("../config/v3-regime-policy");
const signal_gate_format_1 = require("../utils/signal-gate-format");
const candle_hash_1 = require("../utils/candle-hash");
// Cache for duplicate signal detection
const signalCache = new Map();
function getCacheTtl() {
    return (0, v3_schedulers_1.getSignalGateCacheTtlMs)();
}
/**
 * Generate cache key for signal
 */
function generateCacheKey(symbol, timeframe, candleHash) {
    return `${symbol}_${timeframe}_${candleHash}`;
}
/**
 * Clean expired cache entries
 */
function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of signalCache.entries()) {
        if (now - value.timestamp > getCacheTtl()) {
            signalCache.delete(key);
        }
    }
}
/**
 * Default signal gate configuration
 */
const defaultConfig = {
    minGrade: 'A',
    minConfidence: 0.75,
    allowedRegimes: ['trend', 'range'],
    enableDuplicateFilter: true
};
/**
 * Signal Gate Service
 * Evaluates whether a signal is strong enough to proceed to LLM analysis
 */
class SignalGateService {
    config;
    constructor(config) {
        this.config = { ...defaultConfig, ...config };
    }
    /**
     * Evaluate signal and determine if it should proceed to LLM
     */
    async evaluate(input) {
        const { candles, symbol, timeframe, htfRegime } = input;
        // Clean expired cache
        if (this.config.enableDuplicateFilter) {
            cleanExpiredCache();
        }
        // Generate candle hash for duplicate detection
        const candleHash = (0, candle_hash_1.generateCandleHash)(candles);
        const cacheKey = generateCacheKey(symbol, timeframe, candleHash);
        // Check cache for duplicate signal
        if (this.config.enableDuplicateFilter) {
            const cached = signalCache.get(cacheKey);
            if (cached) {
                // Use proper evaluation logic for the cached result
                const gateRegime = this.resolveGateRegime(timeframe, cached.result.regime, htfRegime, cached.result.playbookKey, cached.result.grade);
                const gradePass = this.isGradeAcceptable(cached.result.grade);
                const confidencePass = cached.result.confidence >= this.config.minConfidence;
                const regimePass = this.config.allowedRegimes.includes(gateRegime);
                const pass = gradePass && confidencePass && regimePass;
                console.log(`[SignalGate] Duplicate signal detected for ${symbol} ${timeframe}, using cached result. Pass: ${pass}`);
                return {
                    pass,
                    setupResult: cached.result,
                    reason: 'Duplicate signal - using cached result',
                    shouldCallGroq: false,
                    isDuplicate: true,
                    gateRegime,
                };
            }
        }
        // Analyze setup
        const setupResult = await (0, setup_gate_analyzer_1.analyzeSetupGate)(input);
        // Cache the result
        if (this.config.enableDuplicateFilter) {
            signalCache.set(cacheKey, {
                timestamp: Date.now(),
                result: setupResult
            });
        }
        // Determine if signal passes gate
        const gateRegime = this.resolveGateRegime(timeframe, setupResult.regime, htfRegime, setupResult.playbookKey, setupResult.grade);
        const gradePass = this.isGradeAcceptable(setupResult.grade);
        const confidencePass = setupResult.confidence >= this.config.minConfidence;
        const regimePass = this.config.allowedRegimes.includes(gateRegime);
        const pass = gradePass && confidencePass && regimePass;
        let reason;
        if (pass) {
            const align = gateRegime !== setupResult.regime
                ? (0, v3_regime_policy_1.shouldBypassRegimeForBreakout)(timeframe, setupResult.playbookKey, setupResult.grade)
                    ? ` (breakout ${setupResult.grade} → gate trend; LTF ${setupResult.regime})`
                    : ` (regime LTF ${setupResult.regime} → gate ${gateRegime})`
                : '';
            reason = `Signal passes all gate conditions${align}`;
        }
        else {
            reason = (0, signal_gate_format_1.formatSignalGateBlockReason)({ pass, setupResult, reason: '', shouldCallGroq: false, isDuplicate: false }, this.config);
        }
        return {
            pass,
            setupResult,
            reason,
            shouldCallGroq: pass,
            isDuplicate: false,
            gateRegime,
        };
    }
    resolveGateRegime(timeframe, localRegime, htfRegime, playbookKey, grade) {
        return (0, v3_regime_policy_1.regimeForGatePass)({
            timeframe,
            localRegime,
            htfRegime,
            playbookKey,
            grade,
            alignHtf: (tf, local, htf) => {
                if ((0, v3_entry_policy_1.canAlignLtfRegimeFromHtf)(tf, htf) &&
                    htf === 'trend' &&
                    (local === 'range' || local === 'chop')) {
                    return 'trend';
                }
                return local;
            },
        });
    }
    /**
     * Check if grade meets minimum requirement
     */
    isGradeAcceptable(grade) {
        const gradeOrder = ['A', 'B', 'C', 'D'];
        const minIndex = gradeOrder.indexOf(this.config.minGrade);
        const gradeIndex = gradeOrder.indexOf(grade);
        return gradeIndex <= minIndex;
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Clear signal cache
     */
    clearCache() {
        signalCache.clear();
        console.log('[SignalGate] Cache cleared');
    }
}
exports.SignalGateService = SignalGateService;
function buildSignalGateConfigFromEnv() {
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const minGrade = (0, v3_entry_policy_1.isV3FastSampleMode)() ? 'C' : policy.minSignalGrade;
    return {
        minGrade: (['A', 'B', 'C', 'D'].includes(minGrade) ? minGrade : 'A'),
        minConfidence: (0, v3_entry_policy_1.isV3FastSampleMode)() ? 0.55 : policy.minSignalConfidence,
        allowedRegimes: (0, v3_entry_policy_1.getSignalGateAllowedRegimes)(),
    };
}
// Export singleton instance (wired to MIN_SIGNAL_GRADE / MIN_SIGNAL_CONFIDENCE)
exports.signalGateService = new SignalGateService(buildSignalGateConfigFromEnv());
//# sourceMappingURL=signal-gate.service.js.map