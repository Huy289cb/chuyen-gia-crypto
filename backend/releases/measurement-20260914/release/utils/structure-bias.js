"use strict";
/**
 * Swing-structure bias: HH+HL → bull, LH+LL → bear, else transition.
 * Fractal pivots (left/right bars). Pure — no I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findStructureSwings = findStructureSwings;
exports.classifyStructureBias = classifyStructureBias;
exports.hasBearishStructureBreak = hasBearishStructureBreak;
exports.hasBullishStructureBreak = hasBullishStructureBreak;
/** Fractal pivots: high/low extreme vs `strength` bars each side. */
function findStructureSwings(candles, strength = 2) {
    const out = [];
    if (candles.length < strength * 2 + 1)
        return out;
    const last = candles.length - 1 - strength;
    for (let i = strength; i <= last; i++) {
        const h = candles[i].high;
        const l = candles[i].low;
        let isHigh = true;
        let isLow = true;
        for (let j = i - strength; j <= i + strength; j++) {
            if (j === i)
                continue;
            if (candles[j].high >= h)
                isHigh = false;
            if (candles[j].low <= l)
                isLow = false;
            if (!isHigh && !isLow)
                break;
        }
        if (isHigh)
            out.push({ kind: 'high', price: h, index: i });
        if (isLow)
            out.push({ kind: 'low', price: l, index: i });
    }
    return out;
}
/**
 * Classify from last two swing highs + last two swing lows.
 * Equal highs/lows → transition (strict).
 */
function classifyStructureBias(candles, opts) {
    const strength = opts?.strength ?? 2;
    const swings = findStructureSwings(candles, strength);
    const highs = swings.filter((s) => s.kind === 'high').map((s) => s.price);
    const lows = swings.filter((s) => s.kind === 'low').map((s) => s.price);
    const swingHighs = highs.slice(-2);
    const swingLows = lows.slice(-2);
    if (swingHighs.length < 2 || swingLows.length < 2) {
        return {
            bias: 'transition',
            swingHighs,
            swingLows,
            reason: `insufficient swings (H=${swingHighs.length} L=${swingLows.length})`,
        };
    }
    const [h0, h1] = swingHighs;
    const [l0, l1] = swingLows;
    const hh = h1 > h0;
    const lh = h1 < h0;
    const hl = l1 > l0;
    const ll = l1 < l0;
    if (hh && hl) {
        return {
            bias: 'bull',
            swingHighs,
            swingLows,
            reason: `HH+HL (${h0.toFixed(1)}→${h1.toFixed(1)}, ${l0.toFixed(1)}→${l1.toFixed(1)})`,
        };
    }
    if (lh && ll) {
        return {
            bias: 'bear',
            swingHighs,
            swingLows,
            reason: `LH+LL (${h0.toFixed(1)}→${h1.toFixed(1)}, ${l0.toFixed(1)}→${l1.toFixed(1)})`,
        };
    }
    return {
        bias: 'transition',
        swingHighs,
        swingLows,
        reason: `mixed swings (H ${h0.toFixed(1)}→${h1.toFixed(1)}, L ${l0.toFixed(1)}→${l1.toFixed(1)})`,
    };
}
/**
 * Bearish BOS: last close below prior swing low (l0).
 * LH+LL alone is often a pullback wick — short needs confirmed break, not reclaim.
 */
function hasBearishStructureBreak(detail, lastClose) {
    if (detail.swingLows.length < 2)
        return false;
    const priorLow = detail.swingLows[0];
    return Number.isFinite(lastClose) && Number.isFinite(priorLow) && lastClose < priorLow;
}
/**
 * Bullish BOS: last close above prior swing high (h0).
 * HH+HL alone is often a relief rally in bear — long needs confirmed break, not reject.
 */
function hasBullishStructureBreak(detail, lastClose) {
    if (detail.swingHighs.length < 2)
        return false;
    const priorHigh = detail.swingHighs[0];
    return Number.isFinite(lastClose) && Number.isFinite(priorHigh) && lastClose > priorHigh;
}
//# sourceMappingURL=structure-bias.js.map