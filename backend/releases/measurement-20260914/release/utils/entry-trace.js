"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.withEntryTrace = exports.currentEntryTrace = void 0;
exports.createEntryTrace = createEntryTrace;
exports.tracedEvent = tracedEvent;
exports.recordEntryStage = recordEntryStage;
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const context = new node_async_hooks_1.AsyncLocalStorage();
let fingerprint;
/** Hash the actual source/build tree once per process, without exposing its contents. */
function codeFingerprint() {
    if (fingerprint)
        return fingerprint;
    const root = (0, node_path_1.resolve)(__dirname, '..'), files = [];
    const walk = (dir) => {
        for (const e of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
            const p = (0, node_path_1.resolve)(dir, e.name);
            if (e.isDirectory())
                walk(p);
            else if (/\.(js|ts)$/.test(e.name) && !e.name.endsWith('.d.ts'))
                files.push(p);
        }
    };
    try {
        walk(root);
        const hash = (0, node_crypto_1.createHash)('sha256');
        for (const p of files.sort())
            hash.update((0, node_path_1.relative)(root, p)).update('\0').update((0, node_fs_1.readFileSync)(p)).update('\0');
        fingerprint = hash.digest('hex');
    }
    catch {
        fingerprint = 'unavailable';
    }
    return fingerprint;
}
const currentEntryTrace = () => context.getStore();
exports.currentEntryTrace = currentEntryTrace;
const withEntryTrace = (trace, fn) => context.run(trace, fn);
exports.withEntryTrace = withEntryTrace;
function createEntryTrace(input, policy) {
    const env = Object.fromEntries(Object.keys(process.env).filter(k => /^(V3_|ADAPTIVE_|TRANSITION_RETEST_|RANGE_SWEEP_|POST_|PENDING_ORDER_REENTRY_|CLOSED_CANDLE_)/.test(k)).sort().map(k => [k, process.env[k]]));
    return { ...input, trace_id: (0, node_crypto_1.randomUUID)(), evaluated_at: new Date().toISOString(),
        code_hash: codeFingerprint(), policy_hash: (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ policy, env })).digest('hex') };
}
/** Explicit fields win; no prompts, credentials or provider responses enter this context. */
function tracedEvent(data = {}) {
    return { ...(0, exports.currentEntryTrace)(), ...data };
}
async function recordEntryStage(stage, data = {}) {
    if (!(0, exports.currentEntryTrace)())
        return;
    try {
        const { recordSilentPipelineEvent } = await Promise.resolve().then(() => __importStar(require('../repositories/testnet.repository')));
        const id = await recordSilentPipelineEvent('entry_trace', tracedEvent({ stage, ...data }));
        if (id === null)
            console.warn('[EntryTrace] persistence unavailable');
    }
    catch {
        console.warn('[EntryTrace] persistence unavailable');
    }
}
