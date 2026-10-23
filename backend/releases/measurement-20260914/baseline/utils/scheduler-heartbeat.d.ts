/**
 * Scheduler last-run tracking: in-memory (same process) + DB (worker → API dashboard).
 */
export type SchedulerName = 'MarketScan' | 'LLMDispatch' | 'PositionMonitor' | 'PendingOrderLifecycle';
export declare function recordSchedulerRun(name: SchedulerName): void;
export declare function getSchedulerLastRun(name: SchedulerName): Date | null;
/** Read persisted heartbeat (API process reads worker-written rows). */
export declare function getPersistedSchedulerLastRun(name: SchedulerName): Promise<Date | null>;
export declare function getAllSchedulerHeartbeats(): Record<SchedulerName, string | null>;
/** Dashboard worker liveness — scheduler heartbeats, not OHLCV bar timestamps. */
export declare function inferWorkerActivityStatus(): Promise<'healthy' | 'stale' | 'idle'>;
//# sourceMappingURL=scheduler-heartbeat.d.ts.map