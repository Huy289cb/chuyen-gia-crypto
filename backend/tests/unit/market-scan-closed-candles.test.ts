import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
  getCandles: vi.fn(),
  evaluate: vi.fn(),
  recordSchedulerRun: vi.fn(),
}));

vi.mock('../../src/services/candle.service', () => ({
  getCandles: schedulerMocks.getCandles,
}));

vi.mock('../../src/services/signal-gate.service', () => ({
  signalGateService: { evaluate: schedulerMocks.evaluate },
}));

vi.mock('../../src/utils/scheduler-heartbeat', () => ({
  recordSchedulerRun: schedulerMocks.recordSchedulerRun,
}));

describe('market scan closed-candle input', () => {
  beforeEach(() => {
    schedulerMocks.getCandles.mockReset();
    schedulerMocks.evaluate.mockReset();
    schedulerMocks.recordSchedulerRun.mockReset();
    vi.stubEnv('V3_SIGNAL_GATE_TIMEFRAMES', '1h');
    vi.stubEnv('V3_LTF_ALIGN_REGIME_HTF', 'off');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('excludes the active Binance bar and stores only bar-open timestamps that have closed', async () => {
    const now = Date.parse('2026-08-14T12:00:00Z');
    const hour = 60 * 60_000;
    vi.setSystemTime(now);

    const closed = Array.from({ length: 50 }, (_, index) => ({
      timestamp: now - (50 - index) * hour,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    }));
    const active = { ...closed.at(-1)!, timestamp: now, close: 999 };
    schedulerMocks.getCandles.mockResolvedValue({
      candles: [...closed, active],
      source: 'binance',
    });
    schedulerMocks.evaluate.mockResolvedValue({
      pass: false,
      setupResult: { regime: 'range' },
      reason: 'blocked for test',
      shouldCallGroq: false,
      isDuplicate: false,
    });

    const { getScanResult, runManualMarketScan } = await import(
      '../../src/schedulers/market-scan.scheduler'
    );
    await runManualMarketScan();

    expect(schedulerMocks.evaluate).toHaveBeenCalledOnce();
    expect(schedulerMocks.evaluate.mock.calls[0][0].candles).toEqual(closed);
    expect(schedulerMocks.evaluate.mock.calls[0][0].candles.at(-1)?.timestamp).toBe(now - hour);
    expect(getScanResult('BTC', '1h')?.candles).toEqual(closed);
  });
});
