"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasBinanceFillProof = hasBinanceFillProof;
/** Position was opened via a verified Binance fill — never bookkeeping-close. */
function hasBinanceFillProof(position) {
    return Boolean(position.binance_order_id?.trim());
}
//# sourceMappingURL=binance-fill-proof.js.map