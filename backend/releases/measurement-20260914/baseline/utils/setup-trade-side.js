"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferSetupTradeSide = inferSetupTradeSide;
const liquidity_sweep_analyzer_1 = require("../analyzers/liquidity-sweep.analyzer");
const breakout_volume_analyzer_1 = require("../analyzers/breakout-volume.analyzer");
const signal_gate_windows_1 = require("../config/signal-gate-windows");
/** Infer directional bias from playbook evidence (no LLM). */
function inferSetupTradeSide(setup, timeframe, candles) {
    if (setup.playbookKey === 'breakout_volume') {
        const windows = (0, signal_gate_windows_1.getSignalGateWindows)(timeframe);
        const br = (0, breakout_volume_analyzer_1.analyzeBreakoutVolume)(candles, { windowBars: windows.breakoutBars });
        if (br.direction === 'bullish')
            return 'long';
        if (br.direction === 'bearish')
            return 'short';
        return null;
    }
    if (setup.playbookKey === 'liquidity_sweep_reclaim') {
        const windows = (0, signal_gate_windows_1.getSignalGateWindows)(timeframe);
        const sw = (0, liquidity_sweep_analyzer_1.analyzeLiquiditySweep)(candles, { priorBars: windows.sweepPriorBars });
        if (sw.sweepType === 'low')
            return 'long';
        if (sw.sweepType === 'high')
            return 'short';
        return null;
    }
    // Only setups without a directional playbook may fall back to regime direction.
    if (setup.playbookKey)
        return null;
    const td = setup.evidence.regime.trendDirection;
    if (td === 'bullish')
        return 'long';
    if (td === 'bearish')
        return 'short';
    return null;
}
//# sourceMappingURL=setup-trade-side.js.map