"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.measurePlanGeometry = measurePlanGeometry;
function measurePlanGeometry(p) {
    const blockers = [];
    const invalid = !['long', 'short'].includes(p.side) ||
        ![p.entry, p.stopLoss, p.minSlFraction, p.minRr].every(x => Number.isFinite(x) && x > 0);
    if (invalid)
        return { blockers: ['missing_data'], feasible: false, stopFraction: null,
            requiredTargetFraction: null, availableTargetFraction: null, rr: null };
    const dir = p.side === 'long' ? 1 : -1;
    const stopFraction = dir * (p.entry - p.stopLoss) / p.entry;
    if (stopFraction <= 0)
        blockers.push('invalid_levels');
    else if (stopFraction + 1e-12 < p.minSlFraction)
        blockers.push('stop_floor');
    const requiredTargetFraction = Math.max(p.minSlFraction, stopFraction) * p.minRr;
    const availableTargetFraction = p.targetBound != null && Number.isFinite(p.targetBound) && p.targetBound > 0
        ? dir * (p.targetBound - p.entry) / p.entry : null;
    if (availableTargetFraction === null)
        blockers.push('missing_target_bound');
    else if (availableTargetFraction + 1e-12 < requiredTargetFraction)
        blockers.push('target_room');
    const reward = p.takeProfit != null && Number.isFinite(p.takeProfit) && p.takeProfit > 0
        ? dir * (p.takeProfit - p.entry) / p.entry : null;
    const rr = reward !== null && stopFraction > 0 ? reward / stopFraction : null;
    if (p.takeProfit !== undefined) {
        if (rr === null || reward <= 0)
            blockers.push('invalid_levels');
        else if (rr + 1e-9 < p.minRr)
            blockers.push('rr');
        if (reward !== null && availableTargetFraction !== null && reward > availableTargetFraction + 1e-12)
            blockers.push('target_bound_exceeded');
    }
    return { feasible: blockers.length === 0, blockers, stopFraction, requiredTargetFraction, availableTargetFraction, rr };
}
//# sourceMappingURL=plan-feasibility.js.map