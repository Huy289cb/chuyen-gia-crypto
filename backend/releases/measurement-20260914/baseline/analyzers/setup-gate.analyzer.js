"use strict";
/**
 * Setup Gate Analyzer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSetupGate = analyzeSetupGate;
const signal_gate_windows_1 = require("../config/signal-gate-windows");
const liquidity_sweep_analyzer_1 = require("./liquidity-sweep.analyzer");
const breakout_volume_analyzer_1 = require("./breakout-volume.analyzer");
const market_regime_analyzer_1 = require("./market-regime.analyzer");
const setup_gate_evidence_1 = require("../utils/setup-gate-evidence");
function buildEvidence(input, regimeEvidence, liquiditySweep, breakoutVolume) {
    const last = input.candles[input.candles.length - 1];
    return {
        symbol: input.symbol,
        timeframe: input.timeframe,
        candleCount: input.candles.length,
        lastCandleTime: last?.timestamp ?? null,
        price: last?.close ?? regimeEvidence.currentPrice,
        regime: regimeEvidence,
        playbooks: [liquiditySweep.evidence, breakoutVolume.evidence],
    };
}
function withDetail(base, evidence) {
    return {
        ...base,
        evidence,
        detailReason: (0, setup_gate_evidence_1.formatSetupGateDetail)(evidence),
    };
}
async function analyzeSetupGate(input) {
    const { candles, timeframe } = input;
    const windows = (0, signal_gate_windows_1.getSignalGateWindows)(timeframe);
    if (candles.length < windows.minCandles) {
        const regimeEvidence = (0, market_regime_analyzer_1.computeRegimeEvidence)(candles, {
            regimeBars: windows.regimeBars,
            timeframe,
        });
        const emptyPb = {
            playbook: 'liquidity_sweep',
            detected: false,
            grade: 'D',
            summary: 'Chưa đủ nến để phân tích',
            metrics: {},
        };
        const evidence = buildEvidence(input, regimeEvidence, {
            detected: false,
            grade: 'D',
            confidence: 0,
            reason: 'Insufficient data',
            sweepType: null,
            evidence: emptyPb,
        }, {
            detected: false,
            grade: 'D',
            confidence: 0,
            reason: 'Insufficient data',
            direction: null,
            evidence: { ...emptyPb, playbook: 'breakout_volume' },
        });
        return withDetail({
            playbookKey: null,
            grade: 'D',
            confidence: 0,
            regime: 'chop',
            reason: `Thiếu dữ liệu: ${candles.length}/${windows.minCandles} nến`,
        }, evidence);
    }
    const regimeEvidence = (0, market_regime_analyzer_1.computeRegimeEvidence)(candles, {
        regimeBars: windows.regimeBars,
        timeframe,
    });
    const regime = regimeEvidence.regime;
    const liquiditySweep = (0, liquidity_sweep_analyzer_1.analyzeLiquiditySweep)(candles, { priorBars: windows.sweepPriorBars });
    const breakoutVolume = (0, breakout_volume_analyzer_1.analyzeBreakoutVolume)(candles, { windowBars: windows.breakoutBars });
    const evidence = buildEvidence(input, regimeEvidence, liquiditySweep, breakoutVolume);
    if (regime === 'chop') {
        return withDetail({
            playbookKey: null,
            grade: 'D',
            confidence: 0,
            regime: 'chop',
            reason: regimeEvidence.matchedRule,
        }, evidence);
    }
    let bestSetup = {
        playbookKey: null,
        grade: 'D',
        confidence: 0,
        regime,
        reason: 'Không có setup A/B — xem chi tiết playbook bên dưới',
    };
    // Prefer liquidity_sweep over breakout at the same grade (live BO was drowning LS).
    if (liquiditySweep.detected && liquiditySweep.grade === 'A') {
        bestSetup = {
            playbookKey: 'liquidity_sweep_reclaim',
            grade: 'A',
            confidence: liquiditySweep.confidence,
            regime,
            reason: liquiditySweep.reason,
        };
    }
    else if (breakoutVolume.detected && breakoutVolume.grade === 'A') {
        bestSetup = {
            playbookKey: 'breakout_volume',
            grade: 'A',
            confidence: breakoutVolume.confidence,
            regime,
            reason: breakoutVolume.reason,
        };
    }
    if (bestSetup.grade === 'D') {
        if (liquiditySweep.detected && liquiditySweep.grade === 'B') {
            bestSetup = {
                playbookKey: 'liquidity_sweep_reclaim',
                grade: 'B',
                confidence: liquiditySweep.confidence,
                regime,
                reason: liquiditySweep.reason,
            };
        }
        else if (breakoutVolume.detected && breakoutVolume.grade === 'B') {
            bestSetup = {
                playbookKey: 'breakout_volume',
                grade: 'B',
                confidence: breakoutVolume.confidence,
                regime,
                reason: breakoutVolume.reason,
            };
        }
    }
    return withDetail(bestSetup, evidence);
}
//# sourceMappingURL=setup-gate.analyzer.js.map