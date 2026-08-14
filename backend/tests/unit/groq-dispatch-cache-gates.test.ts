import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalGateOutput } from '../../src/services/signal-gate.service';

const mocks = vi.hoisted(() => ({
  createGroqClient: vi.fn(),
  getCandles: vi.fn(),
  getScanResult: vi.fn(),
  memoryService: {
    findDecisionForBar: vi.fn(),
    buildContextForLLM: vi.fn(),
    formatContextForPrompt: vi.fn(),
    formatRecentReflectionsForPrompt: vi.fn(),
    storeDecision: vi.fn(),
  },
}));

vi.mock('../../src/services/groq-client', () => ({
  createGroqClient: mocks.createGroqClient,
}));
vi.mock('../../src/services/candle.service', () => ({
  getCandles: mocks.getCandles,
}));
vi.mock('../../src/schedulers/market-scan.scheduler', () => ({
  getScanResult: mocks.getScanResult,
}));
vi.mock('../../src/services/memory.service', () => ({
  memoryService: mocks.memoryService,
}));

import { GroqDispatchService } from '../../src/services/groq-dispatch.service';

function bullishBreakoutCandles() {
  const candles = Array.from({ length: 80 }, (_, index) => ({
    timestamp: Date.UTC(2026, 7, 14, 0, index * 15),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
  candles[candles.length - 1] = {
    ...candles[candles.length - 1],
    high: 111,
    close: 110,
    volume: 100,
  };
  return candles;
}

function passingSignal(): SignalGateOutput {
  return {
    pass: true,
    shouldCallGroq: true,
    isDuplicate: false,
    reason: 'pass',
    gateRegime: 'trend',
    setupResult: {
      playbookKey: 'breakout_volume',
      grade: 'A',
      confidence: 0.9,
      regime: 'trend',
      reason: 'bullish breakout',
      detailReason: 'bullish breakout',
      evidence: {
        regime: { trendDirection: 'bullish' },
      },
    },
  } as unknown as SignalGateOutput;
}

describe('GroqDispatch cached trade hard gates', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    process.env.V3_ALLOWED_REGIMES = 'trend';
    mocks.memoryService.findDecisionForBar.mockResolvedValue({
      id: 42,
      symbol: 'BTC',
      timeframe: '15m',
      playbook_key: 'breakout_volume',
      grade: 'A',
      confidence: 0.9,
      regime: 'trend',
      decision: 'trade',
      reason: 'LLM confirmed trade · LLM: buy · conf 90% · entry 100 · SL 99 · TP 103',
      entry_price: 100,
      stop_loss: 99,
      take_profit: 103,
      expected_rr: 3,
      timestamp: new Date(),
      candle_hash: 'hash',
      method_id: 'kim_nghia',
    });
    mocks.memoryService.buildContextForLLM.mockResolvedValue(undefined);
    mocks.memoryService.formatContextForPrompt.mockReturnValue('');
    mocks.memoryService.formatRecentReflectionsForPrompt.mockResolvedValue('');
    mocks.memoryService.storeDecision.mockResolvedValue(undefined);
    // No closed structure candles => transition => hard block.
    mocks.getCandles.mockResolvedValue({ candles: [], source: 'binance' });
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('revalidates a cached trade through structure instead of returning it', async () => {
    const service = new GroqDispatchService();
    const result = await service.dispatch({
      symbol: 'BTC',
      timeframe: '15m',
      candles: bullishBreakoutCandles(),
      systemPrompt: 'system',
      signalResult: passingSignal(),
    });

    expect(result.decision).toBe('no_trade');
    expect(result.reason).toContain('structure transition');
    expect(mocks.getCandles).toHaveBeenCalledOnce();
    expect(mocks.createGroqClient).not.toHaveBeenCalled();
  });
});
