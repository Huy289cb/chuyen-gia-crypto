"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatGateFailureReason = formatGateFailureReason;
exports.formatSignalGateBlockReason = formatSignalGateBlockReason;
exports.formatSignalGateTelegramScan = formatSignalGateTelegramScan;
const v3_schedulers_1 = require("../config/v3-schedulers");
/** Human-readable gate failure (grade / confidence / regime). */
function formatGateFailureReason(output, config) {
    if (output.pass)
        return null;
    const { setupResult } = output;
    const gradeOrder = ['A', 'B', 'C', 'D'];
    const minIndex = gradeOrder.indexOf(config.minGrade);
    const gradeIndex = gradeOrder.indexOf(setupResult.grade);
    const gradePass = gradeIndex <= minIndex;
    const confidencePass = setupResult.confidence >= config.minConfidence;
    const gateRegime = output.gateRegime ?? setupResult.regime;
    const regimePass = config.allowedRegimes.includes(gateRegime);
    if (!gradePass) {
        return `Grade ${setupResult.grade} dưới ngưỡng ${config.minGrade}`;
    }
    if (!confidencePass) {
        return `Confidence ${(setupResult.confidence * 100).toFixed(0)}% dưới ngưỡng ${(config.minConfidence * 100).toFixed(0)}%`;
    }
    if (!regimePass) {
        const localNote = gateRegime !== setupResult.regime
            ? ` (LTF ${setupResult.regime}, gate ${gateRegime})`
            : '';
        return `Regime ${setupResult.regime} không thuộc ${config.allowedRegimes.join('/')}${localNote}`;
    }
    return output.reason || null;
}
/**
 * Full block reason for DB / event log: gate rule + setup analysis.
 */
function formatSignalGateBlockReason(output, config) {
    const gate = formatGateFailureReason(output, config);
    const setup = output.setupResult;
    const parts = [];
    if (gate)
        parts.push(gate);
    if (setup.reason)
        parts.push(`Setup: ${setup.reason}`);
    if (setup.detailReason) {
        const oneLine = setup.detailReason.replace(/\n/g, ' | ');
        parts.push(oneLine.length > 280 ? `${oneLine.slice(0, 277)}…` : oneLine);
    }
    parts.push(`Regime: ${setup.regime}`);
    if (setup.playbookKey)
        parts.push(`Playbook: ${setup.playbookKey}`);
    return parts.join(' · ');
}
function formatTimeframeBlock(row, config) {
    const { timeframe, output } = row;
    const s = output.setupResult;
    const gate = formatGateFailureReason(output, config);
    const header = output.pass
        ? `• ${timeframe}: PASS · grade ${s.grade} · conf ${(s.confidence * 100).toFixed(0)}% · ${s.regime}${s.playbookKey ? ` · ${s.playbookKey}` : ''}`
        : `• ${timeframe}: BLOCK · grade ${s.grade} · ${s.regime}${gate ? ` (${gate})` : ''}`;
    const detail = s.detailReason?.trim();
    if (!detail)
        return header;
    const indented = detail
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
    return `${header}\n${indented}`;
}
/**
 * Single Telegram message for one market-scan cycle (all TFs).
 */
function formatSignalGateTelegramScan(symbol, rows, config) {
    const anyPass = rows.some((r) => r.output.pass && !r.output.isDuplicate);
    const title = anyPass ? '✅ Signal Gate — quét xong' : '🚫 Signal Gate BLOCK — quét xong';
    const sorted = [...rows].sort((a, b) => {
        const order = [...(0, v3_schedulers_1.getV3SignalGateTimeframes)()];
        const ai = order.indexOf(a.timeframe);
        const bi = order.indexOf(b.timeframe);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const lines = sorted.map((r) => formatTimeframeBlock(r, config));
    const policy = `Yêu cầu: grade ≥ ${config.minGrade}, conf ≥ ${(config.minConfidence * 100).toFixed(0)}%, regime ${config.allowedRegimes.join('|')}`;
    return {
        title,
        body: [`${symbol}`, ...lines, policy].join('\n'),
    };
}
//# sourceMappingURL=signal-gate-format.js.map