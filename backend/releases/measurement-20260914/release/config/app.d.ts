/**
 * Application Configuration
 *
 * Central configuration for the backend application
 * including database, API, and worker settings
 */
export interface AppConfig {
    nodeEnv: string;
    port: number;
    databaseUrl: string;
    directUrl?: string;
    apiOnly: boolean;
    workerOnly: boolean;
    workerLeaderLockKey: number;
    priceUpdateIntervalMs: number;
    predictionValidationCron: string;
    dailyMaintenanceCron: string;
    snapshotCron: string;
    /** Kim Nghia Groq analysis (node-cron, 5-field). Env: CRON_SCHEDULE */
    analysisCronSchedule: string;
    retentionDaysPriceHistory: number;
    retentionDaysOhlcv: number;
}
export declare const appConfig: AppConfig;
/**
 * Validate required configuration
 */
export declare function validateAppConfig(): void;
/**
 * Validate safety requirements per Big Update Plan v3
 * This ensures critical safety features cannot be disabled
 */
export declare function validateSafetyRequirements(): void;
/**
 * Check if this is the API process
 */
export declare function isApiProcess(): boolean;
/**
 * Check if this is the worker process
 */
export declare function isWorkerProcess(): boolean;
/**
 * Check if running in production
 */
export declare function isProduction(): boolean;
/**
 * Check if running in development
 */
export declare function isDevelopment(): boolean;
//# sourceMappingURL=app.d.ts.map