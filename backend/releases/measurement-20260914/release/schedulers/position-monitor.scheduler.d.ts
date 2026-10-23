/**
 * Position Monitor Scheduler
 * Monitors open positions — conservative: prefer exchange SL/TP, max one reduce.
 */
export declare function startPositionMonitorScheduler(cronExpression?: string): void;
export declare function stopPositionMonitorScheduler(): void;
export declare function runManualPositionMonitor(): Promise<void>;
//# sourceMappingURL=position-monitor.scheduler.d.ts.map