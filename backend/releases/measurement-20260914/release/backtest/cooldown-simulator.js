"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BacktestCooldownState = void 0;
const risk_policy_1 = require("../config/risk-policy");
/** Walk-forward loss-streak cooldown (mirrors runtime tiered policy). */
class BacktestCooldownState {
    consecutiveLosses = 0;
    cooldownUntil = 0;
    isBlocked(ts) {
        return this.cooldownUntil > ts;
    }
    onTradeClose(pnlUsd, closeTime) {
        if (pnlUsd < 0) {
            this.consecutiveLosses += 1;
            const until = (0, risk_policy_1.resolveLossCooldownUntil)(this.consecutiveLosses, new Date(closeTime));
            if (until) {
                this.cooldownUntil = Math.max(this.cooldownUntil, until.getTime());
            }
        }
        else if (pnlUsd > 0) {
            this.consecutiveLosses = 0;
        }
    }
}
exports.BacktestCooldownState = BacktestCooldownState;
//# sourceMappingURL=cooldown-simulator.js.map