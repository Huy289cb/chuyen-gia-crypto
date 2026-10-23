"use strict";
/**
 * Breakeven SL slightly into profit so a stop fill covers fees.
 * Default ~0.08% ≈ futures round-trip taker on both legs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feeAwareBreakevenSl = feeAwareBreakevenSl;
function feeAwareBreakevenSl(side, entry, feeBufferPct) {
    if (!(entry > 0) || !Number.isFinite(entry))
        return entry;
    const buf = Math.max(0, feeBufferPct) / 100;
    const raw = side === 'long' ? entry * (1 + buf) : entry * (1 - buf);
    return Math.round(raw * 100) / 100;
}
//# sourceMappingURL=breakeven-sl.js.map