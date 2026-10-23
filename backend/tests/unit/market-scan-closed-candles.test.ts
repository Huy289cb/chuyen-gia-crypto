import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
  getCandles: vi.fn(),
  evaluate: vi.fn(),
  recordSchedulerRun: vi.fn(),
  recordFunnel: vi.fn(),
  registerRetest: vi.fn(),
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

vi.mock('../../src/services/entry-gate-funnel.service', () => ({
  recordEntryGateFunnel: schedulerMocks.recordFunnel,
}));

vi.mock('../../src/services/transition-breakout-retest.service', () => ({
  registerTransitionRetestCandidate: schedulerMocks.registerRetest,
  processTransitionRetestScan: vi.fn(),
}));

describe('market scan closed-candle input', () => {
  beforeEach(() => {
    schedulerMocks.getCandles.mockReset();
    schedulerMocks.evaluate.mockReset();
    schedulerMocks.recordSchedulerRun.mockReset();
    schedulerMocks.recordFunnel.mockReset();
    schedulerMocks.registerRetest.mockReset();
    vi.stubEnv('V3_SIGNAL_GATE_TIMEFRAMES', '1h');
    vi.stubEnv('V3_LTF_ALIGN_REGIME_HTF', 'off');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([4, 7, 610])('recovers a %s-second timer stall with one scan of current closed candles', async (stallSeconds) => {
    const boundary = Date.parse('2026-09-08T12:00:00Z');
    vi.setSystemTime(boundary); vi.stubEnv('V3_SIGNAL_GATE_TIMEFRAMES','5m');
    let elapsedSeconds = 0;
    vi.spyOn(process, 'hrtime').mockImplementation((previous?: [number, number]): [number, number] =>
      previous ? [elapsedSeconds, 0] : [123, 0]);
    schedulerMocks.getCandles.mockImplementation(async () => {
      const closedBoundary = Math.floor(Date.now()/300000)*300000;
      return {source:'binance',candles:Array.from({length:60},(_,i)=>({
        timestamp:closedBoundary-(60-i)*300000,open:100,high:101,low:99,close:100,volume:1,
      }))};
    });
    schedulerMocks.evaluate.mockResolvedValue({pass:false,shouldCallGroq:false,isDuplicate:false,
      setupResult:{regime:'range'},reason:'fixture'});
    const {startMarketScanScheduler,stopMarketScanScheduler,getScanResult} = await import('../../src/schedulers/market-scan.scheduler');
    try {
      startMarketScanScheduler('5 */5 * * * *');
      await vi.advanceTimersByTimeAsync(0);
      schedulerMocks.evaluate.mockClear(); schedulerMocks.recordSchedulerRun.mockClear();
      // Wall and monotonic clocks advance while the event loop has not run its timer.
      elapsedSeconds=stallSeconds;vi.setSystemTime(boundary+stallSeconds*1000+123);
      await vi.advanceTimersByTimeAsync(1000);
      expect(schedulerMocks.evaluate).toHaveBeenCalledOnce();
      expect(schedulerMocks.recordSchedulerRun).toHaveBeenCalledTimes(1);
      expect(getScanResult('BTC','5m')!.candles.at(-1)!.timestamp)
        .toBe(Math.floor(Date.now()/300000)*300000-300000);
      elapsedSeconds=1;
      await vi.advanceTimersByTimeAsync(1000);
      expect(schedulerMocks.evaluate).toHaveBeenCalledOnce();
    } finally { stopMarketScanScheduler(); }
  });

  it('excludes the active Binance bar and stores only bar-open timestamps that have closed', async () => {
    const boundary = Date.parse('2026-08-14T12:00:00Z');
    const now = boundary + 5_000;
    const hour = 60 * 60_000;
    vi.setSystemTime(now);

    const closed = Array.from({ length: 50 }, (_, index) => ({
      timestamp: boundary - (50 - index) * hour,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    }));
    const active = { ...closed.at(-1)!, timestamp: boundary, close: 999 };
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

    const { recordEntryGateFunnel } = await import('../../src/services/entry-gate-funnel.service');
    expect(recordEntryGateFunnel).toHaveBeenCalledWith(expect.objectContaining({ signalResult: expect.objectContaining({ pass: false }) }));
    expect(schedulerMocks.evaluate).toHaveBeenCalledOnce();
    expect(schedulerMocks.evaluate.mock.calls[0][0].candles).toEqual(closed);
    expect(schedulerMocks.evaluate.mock.calls[0][0].candles.at(-1)?.timestamp).toBe(boundary - hour);
    expect(getScanResult('BTC', '1h')?.candles).toEqual(closed);
  });
  it('routes a core-blocked range scan to retest observation without making it eligible for core dispatch', async () => {
    const boundary = Date.parse('2026-09-06T12:00:00Z');
    vi.setSystemTime(boundary + 5000);
    vi.stubEnv('V3_SIGNAL_GATE_TIMEFRAMES', '5m');
    const candles = Array.from({length: 60}, (_, i) => ({timestamp: boundary - (60-i)*300000,
      open: 92, high: 94, low: 90, close: 92, volume: 100}));
    const signal = {pass: false, shouldCallGroq: false, isDuplicate: false,
      reason: 'range blocked by core policy', setupResult: {regime: 'range', playbookKey: 'liquidity_sweep_reclaim', grade: 'A'}};
    const observation = {grade: 'A', playbook: 'liquidity_sweep_reclaim', first_block: 'signal_gate', all_blocks: ['signal_gate']};
    schedulerMocks.getCandles.mockResolvedValue({candles, source: 'binance'});
    schedulerMocks.evaluate.mockResolvedValue(signal);
    schedulerMocks.recordFunnel.mockResolvedValue(observation);
    const {runManualMarketScan, getScanResult} = await import('../../src/schedulers/market-scan.scheduler');
    await runManualMarketScan();
    expect(schedulerMocks.registerRetest).toHaveBeenCalledWith(observation, candles, signal, expect.any(Number), expect.any(Function));
    expect(getScanResult('BTC', '5m')?.signalResult.pass).toBe(false);
  });

});
