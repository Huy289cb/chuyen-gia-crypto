export interface WorkerConfig {
  syncSymbols: string[];
  ohlcvTimeframe: string;
  enablePaperTradingSync: boolean;
  enableTestnetSync: boolean;
}

function parseSymbols(value: string | undefined): string[] {
  const raw = (value || 'BTC,ETH')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return raw.length > 0 ? Array.from(new Set(raw)) : ['BTC', 'ETH'];
}

export const workerConfig: WorkerConfig = {
  // Reuse ENABLED_SYMBOLS so API/worker stay aligned by default.
  syncSymbols: parseSymbols(process.env.ENABLED_SYMBOLS),
  ohlcvTimeframe: process.env.WORKER_OHLCV_TIMEFRAME || '1m',
  enablePaperTradingSync: process.env.WORKER_ENABLE_PAPER_TRADING_SYNC !== 'false',
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
