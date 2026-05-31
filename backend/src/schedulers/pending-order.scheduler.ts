/**
 * Periodic review of unfilled limit pending orders (TTL + drift).
 */

import cron, { type ScheduledTask } from 'node-cron';
import { PENDING_ORDER_LIFECYCLE_CRON } from '../config/pending-order-policy';
import { runPendingOrderLifecycle } from '../services/pending-order-lifecycle.service';
import { runPendingOrderReview as runPendingOrderLlmReview } from '../services/pending-order-review.service';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';

let pendingOrderTask: ScheduledTask | null = null;
let isRunning = false;

async function runPendingOrderSchedulerCycle(): Promise<void> {
  if (isRunning) {
    console.warn('[PendingOrderScheduler] Previous run still active — skip');
    return;
  }

  isRunning = true;
  recordSchedulerRun('PendingOrderLifecycle');
  try {
    const lifecycle = await runPendingOrderLifecycle('BTC');
    if (lifecycle.reviewed > 0) {
      console.log(
        `[PendingOrderScheduler] Lifecycle: reviewed ${lifecycle.reviewed}, cancelled ${lifecycle.cancelled}`
      );
    }

    const review = await runPendingOrderLlmReview('BTC');
    if (review.llmCalled) {
      console.log(
        `[PendingOrderScheduler] LLM review: cancelled=${review.cancelled} modified=${review.modified} held=${review.held}`
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PendingOrderScheduler] Failed: ${msg}`);
  } finally {
    isRunning = false;
  }
}

export function startPendingOrderScheduler(
  cronExpression: string = PENDING_ORDER_LIFECYCLE_CRON
): void {
  if (pendingOrderTask) {
    console.warn('[PendingOrderScheduler] Already running');
    return;
  }

  console.log(`[PendingOrderScheduler] Starting cron: ${cronExpression}`);
  pendingOrderTask = cron.schedule(cronExpression, () => {
    void runPendingOrderSchedulerCycle();
  });
}

export function stopPendingOrderScheduler(): void {
  if (pendingOrderTask) {
    pendingOrderTask.stop();
    pendingOrderTask = null;
    console.log('[PendingOrderScheduler] Stopped');
  }
}

export async function runManualPendingOrderReview(): Promise<void> {
  await runPendingOrderSchedulerCycle();
}
