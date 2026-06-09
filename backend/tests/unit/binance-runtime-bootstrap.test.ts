import { describe, it, expect, vi, beforeEach } from 'vitest';

const startBinanceWebSocketSync = vi.fn();
const initializeBinanceReconciliation = vi.fn().mockResolvedValue(undefined);
const initializeHedgeModeDetection = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/binance-hedge-mode', () => ({
  initializeHedgeModeDetection,
}));

vi.mock('../../src/services/binance-websocket-sync', () => ({
  startBinanceWebSocketSync,
}));

vi.mock('../../src/services/binance-reconciliation', () => ({
  initializeBinanceReconciliation,
}));

import { bootstrapBinanceOnWorker } from '../../src/services/binance-runtime-bootstrap';

describe('binance-runtime-bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    process.env.BINANCE_USER_STREAM_ON_WORKER = 'true';
    initializeHedgeModeDetection.mockResolvedValue(undefined);
    initializeBinanceReconciliation.mockResolvedValue(undefined);
  });

  it('starts reconciliation even when user stream listenKey fails', async () => {
    startBinanceWebSocketSync.mockRejectedValue(
      new Error('Binance API Error -1109: Invalid account.')
    );

    await bootstrapBinanceOnWorker();

    expect(startBinanceWebSocketSync).toHaveBeenCalled();
    expect(initializeBinanceReconciliation).toHaveBeenCalled();
  });
});
