import cron from 'node-cron';

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
  retentionDaysPriceHistory: number;
  retentionDaysOhlcv: number;
}

export const appConfig: AppConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  directUrl: process.env.DIRECT_URL,
  apiOnly: process.env.API_ONLY === 'true',
  workerOnly: process.env.WORKER_ONLY === 'true',
  workerLeaderLockKey: parseInt(process.env.WORKER_LEADER_LOCK_KEY || '12345', 10),
  priceUpdateIntervalMs: parseInt(process.env.PRICE_UPDATE_INTERVAL_MS || '30000', 10),
  predictionValidationCron: process.env.PREDICTION_VALIDATION_CRON || '0 * * * *',
  dailyMaintenanceCron: process.env.DAILY_MAINTENANCE_CRON || '0 3 * * *',
  snapshotCron: process.env.SNAPSHOT_CRON || '*/5 * * * *',
  retentionDaysPriceHistory: parseInt(process.env.RETENTION_DAYS_PRICE_HISTORY || '30', 10),
  retentionDaysOhlcv: parseInt(process.env.RETENTION_DAYS_OHLCV || '90', 10),
};

/**
 * Validate required configuration
 */
export function validateAppConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const required = ['DATABASE_URL'];
    for (const envVar of required) {
      if (!process.env[envVar]) {
        throw new Error(`${envVar} is required in production`);
      }
    }
  }

  const errors: string[] = [];

  // Only require DATABASE_URL in production
  if (process.env.NODE_ENV === 'production' && !appConfig.databaseUrl) {
    errors.push('DATABASE_URL is required in production');
  }

  if (appConfig.apiOnly && appConfig.workerOnly) {
    errors.push('Cannot set both API_ONLY and WORKER_ONLY to true');
  }

  if (!Number.isFinite(appConfig.priceUpdateIntervalMs) || appConfig.priceUpdateIntervalMs < 5000) {
    errors.push('PRICE_UPDATE_INTERVAL_MS must be a number >= 5000');
  }

  if (!cron.validate(appConfig.predictionValidationCron)) {
    errors.push('PREDICTION_VALIDATION_CRON is invalid');
  }

  if (!cron.validate(appConfig.dailyMaintenanceCron)) {
    errors.push('DAILY_MAINTENANCE_CRON is invalid');
  }

  if (!cron.validate(appConfig.snapshotCron)) {
    errors.push('SNAPSHOT_CRON is invalid');
  }

  if (!Number.isFinite(appConfig.retentionDaysPriceHistory) || appConfig.retentionDaysPriceHistory < 1) {
    errors.push('RETENTION_DAYS_PRICE_HISTORY must be a number >= 1');
  }

  if (!Number.isFinite(appConfig.retentionDaysOhlcv) || appConfig.retentionDaysOhlcv < 1) {
    errors.push('RETENTION_DAYS_OHLCV must be a number >= 1');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration: ${errors.join(', ')}`);
  }
}

/**
 * Check if this is the API process
 */
export function isApiProcess(): boolean {
  return appConfig.workerOnly === false;
}

/**
 * Check if this is the worker process
 */
export function isWorkerProcess(): boolean {
  return appConfig.apiOnly === false;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return appConfig.nodeEnv === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return appConfig.nodeEnv === 'development';
}
