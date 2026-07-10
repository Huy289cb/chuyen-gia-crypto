/**
 * Scheduler last-run tracking: in-memory (same process) + DB (worker → API dashboard).
 */

import { prisma } from '../lib/prisma';

export type SchedulerName =
  | 'MarketScan'
  | 'LLMDispatch'
  | 'PositionMonitor'
  | 'PendingOrderLifecycle';

const lastRuns = new Map<SchedulerName, Date>();
const lastPersistedAt = new Map<SchedulerName, number>();

/** Min interval between DB upserts (in-memory lastRuns still update every cycle). */
const MIN_HEARTBEAT_PERSIST_MS = parseInt(
  process.env.SCHEDULER_HEARTBEAT_PERSIST_INTERVAL_MS || '120000',
  10
);

export function recordSchedulerRun(name: SchedulerName): void {
  const now = new Date();
  lastRuns.set(name, now);

  const lastPersist = lastPersistedAt.get(name) ?? 0;
  if (Date.now() - lastPersist < MIN_HEARTBEAT_PERSIST_MS) {
    return;
  }
  lastPersistedAt.set(name, Date.now());

  void persistSchedulerHeartbeat(name, now).catch((err) => {
    console.error(`[SchedulerHeartbeat] Failed to persist ${name}:`, err);
  });
}

async function persistSchedulerHeartbeat(name: SchedulerName, lastRun: Date): Promise<void> {
  await prisma.schedulerHeartbeat.upsert({
    where: { name },
    create: { name, last_run: lastRun },
    update: { last_run: lastRun },
  });
}

export function getSchedulerLastRun(name: SchedulerName): Date | null {
  return lastRuns.get(name) ?? null;
}

/** Read persisted heartbeat (API process reads worker-written rows). */
export async function getPersistedSchedulerLastRun(
  name: SchedulerName
): Promise<Date | null> {
  try {
    const row = await prisma.schedulerHeartbeat.findUnique({ where: { name } });
    return row?.last_run ?? null;
  } catch {
    return null;
  }
}

export function getAllSchedulerHeartbeats(): Record<SchedulerName, string | null> {
  return {
    MarketScan: lastRuns.get('MarketScan')?.toISOString() ?? null,
    LLMDispatch: lastRuns.get('LLMDispatch')?.toISOString() ?? null,
    PositionMonitor: lastRuns.get('PositionMonitor')?.toISOString() ?? null,
    PendingOrderLifecycle: lastRuns.get('PendingOrderLifecycle')?.toISOString() ?? null,
  };
}
