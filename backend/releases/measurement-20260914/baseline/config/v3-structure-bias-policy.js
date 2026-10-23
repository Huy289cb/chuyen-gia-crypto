"use strict";
/**
 * Structure-first bias permission (Phase A).
 * See docs/structure-first-bias-plan.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isV3StructureShortRequireBos = isV3StructureShortRequireBos;
exports.isV3StructureLongRequireBos = isV3StructureLongRequireBos;
exports.isV3StructureBiasEnabled = isV3StructureBiasEnabled;
exports.getV3StructureBiasTf = getV3StructureBiasTf;
exports.getV3StructureBiasStrength = getV3StructureBiasStrength;
exports.getV3StructureBiasCandleLimit = getV3StructureBiasCandleLimit;
exports.evaluateStructureSidePermission = evaluateStructureSidePermission;
exports.isV3RequirePlaybookSideMatch = isV3RequirePlaybookSideMatch;
exports.evaluatePlaybookSideMatch = evaluatePlaybookSideMatch;
exports.formatLlmGateContext = formatLlmGateContext;
const structure_bias_1 = require("../utils/structure-bias");
/** Short needs LH+LL + BOS (close below prior swing low). Default on. */
function isV3StructureShortRequireBos() {
    return process.env.V3_STRUCTURE_SHORT_REQUIRE_BOS !== 'false';
}
/** Long needs HH+HL + BOS (close above prior swing high). Default on — mirror short. */
function isV3StructureLongRequireBos() {
    return process.env.V3_STRUCTURE_LONG_REQUIRE_BOS !== 'false';
}
function isV3StructureBiasEnabled() {
    return process.env.V3_STRUCTURE_BIAS_ENABLED !== 'false';
}
function getV3StructureBiasTf() {
    return process.env.V3_STRUCTURE_BIAS_TF?.trim() || '4h';
}
function getV3StructureBiasStrength() {
    const v = parseInt(process.env.V3_STRUCTURE_BIAS_STRENGTH || '2', 10);
    return Number.isFinite(v) && v >= 1 ? v : 2;
}
/** Candle limit for structure TF (need room for pivots). */
function getV3StructureBiasCandleLimit() {
    const v = parseInt(process.env.V3_STRUCTURE_BIAS_CANDLE_LIMIT || '120', 10);
    return Number.isFinite(v) && v >= 40 ? v : 120;
}
/**
 * bull → long only (+BOS); bear → short only (+BOS); transition → flat.
 * Short: block LH+LL reclaim (Aug-24). Long: block HH+HL relief in bear (Aug 8–12 mirror).
 */
function evaluateStructureSidePermission(input) {
    const enabled = input.enabled ?? isV3StructureBiasEnabled();
    if (!enabled) {
        return { pass: true, bias: 'transition', reason: 'structure bias disabled' };
    }
    const detail = (0, structure_bias_1.classifyStructureBias)(input.candles, {
        strength: input.strength ?? getV3StructureBiasStrength(),
    });
    const { bias } = detail;
    const last = input.candles[input.candles.length - 1];
    const lastClose = last?.close ?? (input.side === 'short' ? last?.low : last?.high);
    if (bias === 'transition') {
        return {
            pass: false,
            bias,
            reason: `blocked: structure transition — flat (${detail.reason}) (V3_STRUCTURE_BIAS)`,
            detail,
        };
    }
    if (bias === 'bull' && input.side === 'long') {
        const requireBos = input.longRequireBos ?? isV3StructureLongRequireBos();
        if (requireBos) {
            if (lastClose == null || !(0, structure_bias_1.hasBullishStructureBreak)(detail, lastClose)) {
                const prior = detail.swingHighs[0];
                return {
                    pass: false,
                    bias,
                    reason: `blocked: bull HH+HL but no BOS (close ${lastClose ?? 'n/a'} ≤ prior high ${prior}) ` +
                        `(V3_STRUCTURE_LONG_REQUIRE_BOS)`,
                    detail,
                };
            }
        }
        return { pass: true, bias, reason: `structure bull allows long (${detail.reason})`, detail };
    }
    if (bias === 'bear' && input.side === 'short') {
        const requireBos = input.shortRequireBos ?? isV3StructureShortRequireBos();
        if (requireBos) {
            if (lastClose == null || !(0, structure_bias_1.hasBearishStructureBreak)(detail, lastClose)) {
                const prior = detail.swingLows[0];
                return {
                    pass: false,
                    bias,
                    reason: `blocked: bear LH+LL but no BOS (close ${lastClose ?? 'n/a'} ≥ prior low ${prior}) ` +
                        `(V3_STRUCTURE_SHORT_REQUIRE_BOS)`,
                    detail,
                };
            }
        }
        return { pass: true, bias, reason: `structure bear allows short (${detail.reason})`, detail };
    }
    return {
        pass: false,
        bias,
        reason: `blocked: ${input.side} against structure ${bias} (${detail.reason}) (V3_STRUCTURE_BIAS)`,
        detail,
    };
}
/** Playbook direction must match LLM side (Phase B). Default on. */
function isV3RequirePlaybookSideMatch() {
    return process.env.V3_REQUIRE_PLAYBOOK_SIDE_MATCH !== 'false';
}
function evaluatePlaybookSideMatch(input) {
    const enabled = input.enabled ?? isV3RequirePlaybookSideMatch();
    if (!enabled)
        return { pass: true };
    if (!input.playbookSide) {
        return {
            pass: false,
            reason: 'blocked: playbook has no direction (V3_REQUIRE_PLAYBOOK_SIDE_MATCH)',
        };
    }
    if (input.playbookSide !== input.llmSide) {
        return {
            pass: false,
            reason: `blocked: LLM ${input.llmSide} ≠ playbook ${input.playbookSide} (V3_REQUIRE_PLAYBOOK_SIDE_MATCH)`,
        };
    }
    return { pass: true, reason: `playbook ${input.playbookSide} matches LLM` };
}
/** Facts for LLM confirm/veto — do not let the model invent HTF/playbook. */
function formatLlmGateContext(input) {
    const side = input.playbookSide ?? 'unknown';
    const confirm = side === 'long' ? 'buy' : side === 'short' ? 'sell' : 'hold';
    const lines = [
        'GATE CONTEXT (deterministic — do not contradict):',
        `- Entry TF: ${input.timeframe}`,
        `- Playbook: ${input.playbookKey} → side ${side}`,
    ];
    if (input.structureBias) {
        lines.push(`- Structure bias (4h): ${input.structureBias}`);
    }
    if (input.htfTf) {
        lines.push(`- HTF ${input.htfTf}: ${input.htfRegime ?? 'unknown'}/${input.htfDirection ?? 'null'}`);
    }
    lines.push(`- Confirm ONLY "${confirm}" (with SL/TP) or "hold". Never the opposite side.`, '- Hold is a valid veto. Do not invent BOS/CHOCH/OB/FVG/Fibo numbers.');
    return lines.join('\n');
}
//# sourceMappingURL=v3-structure-bias-policy.js.map