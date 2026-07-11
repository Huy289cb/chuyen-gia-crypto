import { getEnabledSymbols } from './symbol-policy';

export interface WorkerConfig {
  syncSymbols: string[];
  ohlcvTimeframe: string;
  enableTestnetSync: boolean;
}

export const workerConfig: WorkerConfig = {
  // Reuse ENABLED_SYMBOLS so API/worker stay aligned by default.
  syncSymbols: getEnabledSymbols(),
  ohlcvTimeframe: process.env.WORKER_OHLCV_TIMEFRAME || '1m',
  enableTestnetSync: process.env.WORKER_ENABLE_TESTNET_SYNC !== 'false',
};

export function validateWorkerConfig(): void {
  if (workerConfig.syncSymbols.length === 0) {
    throw new Error('ENABLED_SYMBOLS must contain at least one symbol');
  }

  if (!workerConfig.ohlcvTimeframe.trim()) {
    throw new Error('WORKER_OHLCV_TIMEFRAME must not be empty');
  }
}
