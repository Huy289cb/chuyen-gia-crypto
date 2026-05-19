/**
 * In-memory last-run timestamps for v3 schedulers (accurate dashboard status).
 */

export type SchedulerName = 'MarketScan' | 'LLMDispatch' | 'PositionMonitor';

const lastRuns = new Map<SchedulerName, Date>();

export function recordSchedulerRun(name: SchedulerName): void {
  lastRuns.set(name, new Date());
}

export function getSchedulerLastRun(name: SchedulerName): Date | null {
  return lastRuns.get(name) ?? null;
}

export function getAllSchedulerHeartbeats(): Record<SchedulerName, string | null> {
  return {
    MarketScan: lastRuns.get('MarketScan')?.toISOString() ?? null,
    LLMDispatch: lastRuns.get('LLMDispatch')?.toISOString() ?? null,
    PositionMonitor: lastRuns.get('PositionMonitor')?.toISOString() ?? null,
  };
}
