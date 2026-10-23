"use strict";
/**
 * Periodic review of unfilled limit pending orders (TTL + drift).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPendingOrderScheduler = startPendingOrderScheduler;
exports.stopPendingOrderScheduler = stopPendingOrderScheduler;
exports.runManualPendingOrderReview = runManualPendingOrderReview;
const node_cron_1 = __importDefault(require("node-cron"));
const pending_order_policy_1 = require("../config/pending-order-policy");
const pending_order_lifecycle_service_1 = require("../services/pending-order-lifecycle.service");
const pending_order_review_service_1 = require("../services/pending-order-review.service");
const scheduler_heartbeat_1 = require("../utils/scheduler-heartbeat");
let pendingOrderTask = null;
let isRunning = false;
async function runPendingOrderSchedulerCycle() {
    if (isRunning) {
        console.warn('[PendingOrderScheduler] Previous run still active — skip');
        return;
    }
    isRunning = true;
    (0, scheduler_heartbeat_1.recordSchedulerRun)('PendingOrderLifecycle');
    try {
        const lifecycle = await (0, pending_order_lifecycle_service_1.runPendingOrderLifecycle)('BTC');
        if (lifecycle.reviewed > 0) {
            console.log(`[PendingOrderScheduler] Lifecycle: reviewed ${lifecycle.reviewed}, cancelled ${lifecycle.cancelled}`);
        }
        const review = await (0, pending_order_review_service_1.runPendingOrderReview)('BTC');
        if (review.llmCalled) {
            console.log(`[PendingOrderScheduler] LLM review: cancelled=${review.cancelled} modified=${review.modified} held=${review.held}`);
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[PendingOrderScheduler] Failed: ${msg}`);
    }
    finally {
        isRunning = false;
    }
}
function startPendingOrderScheduler(cronExpression = pending_order_policy_1.PENDING_ORDER_LIFECYCLE_CRON) {
    if (pendingOrderTask) {
        console.warn('[PendingOrderScheduler] Already running');
        return;
    }
    console.log(`[PendingOrderScheduler] Starting cron: ${cronExpression}`);
    pendingOrderTask = node_cron_1.default.schedule(cronExpression, () => {
        void runPendingOrderSchedulerCycle();
    });
}
function stopPendingOrderScheduler() {
    if (pendingOrderTask) {
        pendingOrderTask.stop();
        pendingOrderTask = null;
        console.log('[PendingOrderScheduler] Stopped');
    }
}
async function runManualPendingOrderReview() {
    await runPendingOrderSchedulerCycle();
}
//# sourceMappingURL=pending-order.scheduler.js.map