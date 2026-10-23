"use strict";
/**
 * Apply profit-protect SL (breakeven / trail) on Binance + local DB.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberInitialRisk = rememberInitialRisk;
exports.getRememberedInitialRisk = getRememberedInitialRisk;
exports.clearProfitProtectState = clearProfitProtectState;
exports.maybeApplyProfitProtectSl = maybeApplyProfitProtectSl;
const profit_protect_policy_1 = require("../config/profit-protect-policy");
const profit_protect_sl_1 = require("../utils/profit-protect-sl");
const amend_protective_sl_service_1 = require("./amend-protective-sl.service");
/** Remember original risk distance so R multiples stay valid after BE move. */
const initialRiskByPosition = new Map();
function rememberInitialRisk(positionId, entry, stopLoss, side) {
    const existing = initialRiskByPosition.get(positionId);
    if (existing != null && existing > 0)
        return existing;
    const localSide = side.toLowerCase() === 'short' ? 'short' : 'long';
    const risk = localSide === 'long'
        ? Math.max(0, entry - stopLoss)
        : Math.max(0, stopLoss - entry);
    if (risk > 0) {
        initialRiskByPosition.set(positionId, risk);
    }
    return risk;
}
function getRememberedInitialRisk(positionId) {
    return initialRiskByPosition.get(positionId);
}
function clearProfitProtectState(positionId) {
    initialRiskByPosition.delete(positionId);
}
async function maybeApplyProfitProtectSl(position, mark) {
    if (!(0, profit_protect_policy_1.isProfitProtectEnabled)()) {
        return { applied: false, reason: 'profit protect disabled' };
    }
    if (process.env.BINANCE_ENABLED !== 'true') {
        return { applied: false, reason: 'binance disabled' };
    }
    const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
    const ageMinutes = (Date.now() - position.entry_time.getTime()) / 60_000;
    const initialRisk = rememberInitialRisk(position.position_id, position.entry_price, position.stop_loss, side);
    const plan = (0, profit_protect_sl_1.computeProfitProtectSl)({
        side,
        entry: position.entry_price,
        mark,
        currentSl: position.stop_loss,
        initialRisk: initialRisk > 0 ? initialRisk : undefined,
        ageMinutes,
        beAtR: (0, profit_protect_policy_1.getBreakevenAtR)(),
        trailActivatePct: (0, profit_protect_policy_1.getTrailActivatePct)(),
        trailDistancePct: (0, profit_protect_policy_1.getTrailDistancePct)(),
        minSlMovePct: (0, profit_protect_policy_1.getMinSlMovePct)(),
        minAgeMinutes: (0, profit_protect_policy_1.getProfitProtectMinMinutes)(),
        timeStopHours: (0, profit_protect_policy_1.getTimeStopHours)(),
        beFeeBufferPct: (0, profit_protect_policy_1.getBreakevenFeeBufferPct)(),
    });
    if (plan.action === 'none') {
        return { applied: false, reason: plan.reason };
    }
    const amended = await (0, amend_protective_sl_service_1.amendProtectiveStopLoss)({
        position,
        newSl: plan.newSl,
        mark,
        eventType: 'profit_protect_sl',
        action: plan.action,
        reason: plan.reason,
        meta: {
            unrealized_pct: plan.unrealizedPct,
            r_multiple: plan.rMultiple,
        },
    });
    if (!amended.ok) {
        console.error(`[ProfitProtect] Failed to amend SL for ${position.position_id} @ ${plan.newSl}: ${amended.reason}`);
        return { applied: false, reason: amended.reason };
    }
    console.log(`[ProfitProtect] ${position.position_id} ${plan.action}: SL ${position.stop_loss}→${plan.newSl} ` +
        `(${plan.reason}) mark=${mark} uPnL=${plan.unrealizedPct.toFixed(2)}% ${plan.rMultiple.toFixed(2)}R`);
    return { applied: true, reason: plan.reason, newSl: plan.newSl };
}
//# sourceMappingURL=profit-protect.service.js.map