export type KimNghiaAnalysisJobResult = {
    success: true;
    data: unknown;
} | {
    success: false;
    error: string;
};
/**
 * Runs Kim Nghia Groq analysis, updates cache, and persists BTC/ETH rows.
 * Used by POST /api/analysis/run and the worker CRON_SCHEDULE job.
 */
export declare function runKimNghiaAnalysisJob(): Promise<KimNghiaAnalysisJobResult>;
//# sourceMappingURL=kim-nghia-analysis-job.d.ts.map