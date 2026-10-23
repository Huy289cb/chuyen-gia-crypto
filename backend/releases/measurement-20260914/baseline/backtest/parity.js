"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBacktestMinRr = resolveBacktestMinRr;
const methods_1 = require("../config/methods");
/** Resolve the same minimum R:R used by the production kim_nghia execution path. */
function resolveBacktestMinRr(override) {
    if (override != null) {
        if (!Number.isFinite(override) || override <= 0) {
            throw new Error(`Invalid backtest min R:R: ${override}`);
        }
        return override;
    }
    return (0, methods_1.getMethodConfig)('kim_nghia').autoEntry.minRRRatio;
}
//# sourceMappingURL=parity.js.map