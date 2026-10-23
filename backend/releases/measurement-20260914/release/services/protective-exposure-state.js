"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setProtectiveExposureEntryBlock = setProtectiveExposureEntryBlock;
exports.clearProtectiveExposureEntryBlock = clearProtectiveExposureEntryBlock;
exports.getProtectiveExposureEntryBlock = getProtectiveExposureEntryBlock;
let entryBlock = null;
function setProtectiveExposureEntryBlock(reason, ttlMs) {
    entryBlock = {
        reason,
        until: Date.now() + Math.max(ttlMs, 1),
        updatedAt: Date.now(),
    };
}
function clearProtectiveExposureEntryBlock() {
    entryBlock = null;
}
function getProtectiveExposureEntryBlock() {
    if (!entryBlock)
        return null;
    if (Date.now() > entryBlock.until) {
        entryBlock = null;
        return null;
    }
    return entryBlock;
}
//# sourceMappingURL=protective-exposure-state.js.map