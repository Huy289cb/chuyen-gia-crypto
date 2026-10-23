export declare function formatRelativeAgo(ts: Date | null): string;
export interface SchedulerStatusRow {
    name: string;
    cron: string;
    status: string;
    lastRun: string;
    lastRunAt: string | null;
}
export interface SystemHealthSnapshot {
    workerStatus: string;
    databaseStatus: string;
    safetyValidation: string;
    lockStatus: string;
    schedulers: SchedulerStatusRow[];
    warmup: {
        isWarmedUp: boolean;
        timeframes: Array<{
            name: string;
            loaded: number;
            required: number;
        }>;
    };
    risk: {
        dailyLossCurrent: number;
        dailyLossCapUsd: number;
        isLocked: boolean;
        lockReason: string | null;
    };
    binanceEnabled: boolean;
    recentErrors: Array<{
        event_type: string;
        timestamp: string;
        summary: string;
    }>;
}
export declare function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot>;
export declare function getLlmStatsTodayIct(): Promise<{
    total: number;
    trades: number;
    noTrades: number;
}>;
export declare function getLastKimDecision(): Promise<{
    decision: string;
    reason: string | null;
    timestamp: Date;
} | null>;
export declare function getTopNoTradeReasonsIct(limit?: number): Promise<Array<{
    reason: string;
    count: number;
}>>;
//# sourceMappingURL=system-health.service.d.ts.map