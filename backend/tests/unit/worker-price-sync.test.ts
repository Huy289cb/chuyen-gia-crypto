import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(), fetchPrices: vi.fn(), latest: vi.fn(), history: vi.fn(),
}));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
vi.mock('../../src/config/app', () => ({ appConfig: {
  priceUpdateIntervalMs: 1000, predictionValidationCron: 'validate',
  snapshotCron: 'snapshot', dailyMaintenanceCron: 'maintenance',
} }));
vi.mock('../../src/config/worker', () => ({ validateWorkerConfig: vi.fn(), workerConfig: {
  syncSymbols: ['BTC'], enableTestnetSync: false, ohlcvTimeframe: '5m',
} }));
vi.mock('../../src/repositories/analysis.repository', () => ({ validatePredictions: vi.fn() }));
vi.mock('../../src/repositories/market.repository', () => ({ saveLatestPrice: mocks.latest, savePriceHistory: mocks.history }));
vi.mock('../../src/services/runtime-maintenance', () => ({ createTradingSnapshots: vi.fn(), runDataRetention: vi.fn() }));
vi.mock('../../src/services/testnet-sync', () => ({ syncTestnetForSymbol: vi.fn() }));
vi.mock('../../src/services/price-fetcher', () => ({ fetchRealTimePrices: mocks.fetchPrices }));
vi.mock('../../src/schedulers/market-scan.scheduler', () => ({ startMarketScanScheduler: vi.fn() }));
vi.mock('../../src/schedulers/llm-dispatch.scheduler', () => ({ startLLMDispatchScheduler: vi.fn() }));
vi.mock('../../src/config/v3-schedulers', () => ({ V3_MARKET_SCAN_CRON: 'scan', V3_LLM_DISPATCH_CRON: 'dispatch' }));
vi.mock('../../src/schedulers/position-monitor.scheduler', () => ({ startPositionMonitorScheduler: vi.fn() }));
vi.mock('../../src/schedulers/pending-order.scheduler', () => ({ startPendingOrderScheduler: vi.fn() }));
vi.mock('../../src/services/binance-balance-sync.service', () => ({ syncAllTestnetAccountsFromBinance: vi.fn() }));
vi.mock('../../src/services/protective-exposure-audit.service', () => ({ auditProtectiveCoverageForSymbols: vi.fn() }));
vi.mock('../../src/services/position-lifecycle-guard.service', () => ({ protectiveAuditStartupDelayMs: vi.fn() }));

let scheduler: typeof import('../../src/services/worker-scheduler');
const tick = (price: number) => ({ btc: { price, volume: 100 } });
describe('worker price persistence after transient database failures', () => {
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T13:00:00Z'));
    vi.stubEnv('BINANCE_ENABLED', 'false'); vi.stubEnv('PROTECTIVE_EXPOSURE_AUDIT_ENABLED', 'false');
    mocks.schedule.mockReturnValue({ stop: vi.fn() });
    mocks.latest.mockReset().mockResolvedValue(undefined);
    mocks.history.mockReset().mockResolvedValue(undefined);
    mocks.fetchPrices.mockReset().mockResolvedValue(tick(100000));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    scheduler = await import('../../src/services/worker-scheduler');
  });
  afterEach(() => {
    scheduler?.stopWorkerScheduler(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
  it('retries the same price next cycle when the previous LatestPrice write timed out', async () => {
    mocks.latest.mockRejectedValueOnce(Object.assign(new Error('pool timeout'), { code: 'P2024' }));
    await scheduler.startWorkerScheduler();
    expect(mocks.latest).toHaveBeenCalledOnce();
    expect(mocks.history).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.latest).toHaveBeenCalledTimes(2);
    expect(mocks.latest.mock.calls[1][0].price).toBe(100000);
    expect(mocks.history).toHaveBeenCalledOnce();
  });
  it('measures cumulative movement against the last saved price with the same 0.01% threshold', async () => {
    mocks.fetchPrices.mockResolvedValueOnce(tick(100000)).mockResolvedValueOnce(tick(100004))
      .mockResolvedValueOnce(tick(100008)).mockResolvedValueOnce(tick(100012));
    await scheduler.startWorkerScheduler();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.latest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.latest).toHaveBeenCalledTimes(2);
    expect(mocks.latest.mock.calls[1][0].price).toBe(100012);
  });
  it('retains a successful LatestPrice write while separately retrying failed price history', async () => {
    mocks.history.mockRejectedValueOnce(new Error('history timeout'));
    await scheduler.startWorkerScheduler();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.latest).toHaveBeenCalledOnce();
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });
});
