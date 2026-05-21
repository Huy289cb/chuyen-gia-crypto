/**
 * Scheduler last-run tracking: in-memory (same process) + DB (worker → API dashboard).
 */

import { prisma } from '../lib/prisma';

export type SchedulerName = 'MarketScan' | 'LLMDispatch' | 'PositionMonitor';

const lastRuns = new Map<SchedulerName, Date>();

export function recordSchedulerRun(name: SchedulerName): void {
  const now = new Date();
  lastRuns.set(name, now);
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
  };
}
