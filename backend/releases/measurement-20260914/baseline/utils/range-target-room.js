"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasRangeTargetRoom = hasRangeTargetRoom;
/** A range-reversion target must be reachable inside the observed box, without assuming a breakout. */
function hasRangeTargetRoom(input) {
    const low = Number(input.rangeLow), high = Number(input.rangeHigh);
    if (![low, high, input.entry, input.target].every(Number.isFinite) || low <= 0 || high <= low)
        return false;
    return input.side === 'long'
        ? input.target > input.entry && input.target <= high && input.entry >= low
        : input.target < input.entry && input.target >= low && input.entry <= high;
}
//# sourceMappingURL=range-target-room.js.map