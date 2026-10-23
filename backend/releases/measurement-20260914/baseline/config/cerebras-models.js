"use strict";
/** Cerebras dispatch fallback configuration (no service imports). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CEREBRAS_DISPATCH_MODEL_DEFAULT = void 0;
exports.isCerebrasDispatchFallbackEnabled = isCerebrasDispatchFallbackEnabled;
exports.getCerebrasDispatchModel = getCerebrasDispatchModel;
exports.CEREBRAS_DISPATCH_MODEL_DEFAULT = 'gpt-oss-120b';
function isCerebrasDispatchFallbackEnabled() {
    if (process.env.CEREBRAS_DISPATCH_FALLBACK_ENABLED === 'false')
        return false;
    return !!process.env.CEREBRAS_API_KEY?.trim();
}
function getCerebrasDispatchModel() {
    return process.env.CEREBRAS_DISPATCH_MODEL?.trim() || exports.CEREBRAS_DISPATCH_MODEL_DEFAULT;
}
//# sourceMappingURL=cerebras-models.js.map