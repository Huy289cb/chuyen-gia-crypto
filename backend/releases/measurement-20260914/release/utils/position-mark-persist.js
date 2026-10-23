"use strict";
/**
 * Throttle mark-price / unrealized PnL writes — trading correctness uses exchange state;
 * DB marks are for dashboard display and can lag briefly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldPersistPositionMark = shouldPersistPositionMark;
exports.notePositionMarkPersisted = notePositionMarkPersisted;
const lastPersistAt = new Map();
const MIN_INTERVAL_MS = parseInt(process.env.POSITION_MARK_PERSIST_INTERVAL_MS || '300000', 10);
const MIN_RELATIVE_MOVE = parseFloat(process.env.POSITION_MARK_PERSIST_MIN_MOVE || '0.002');
function shouldPersistPositionMark(positionId, markPrice, storedMark, unrealizedPnL, storedUnrealized, force = false) {
    if (force)
        return true;
    const now = Date.now();
    const last = lastPersistAt.get(positionId) ?? 0;
    if (now - last < MIN_INTERVAL_MS) {
        return false;
    }
    const ref = Math.max(Math.abs(storedMark), Math.abs(markPrice), 1e-9);
    const markMoved = Math.abs(markPrice - storedMark) / ref >= MIN_RELATIVE_MOVE;
    const pnlMoved = Math.abs(unrealizedPnL - storedUnrealized) >= 0.5;
    return markMoved || pnlMoved;
}
function notePositionMarkPersisted(positionId) {
    lastPersistAt.set(positionId, Date.now());
}
//# sourceMappingURL=position-mark-persist.js.map