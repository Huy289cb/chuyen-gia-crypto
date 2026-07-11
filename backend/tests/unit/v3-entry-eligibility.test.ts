import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getOrCreateTestnetAccount: vi.fn(),
  getActiveTestnetPositions: vi.fn(),
  getBlockingTestnetPendingOrders: vi.fn(),
}));

vi.mock('../../src/config/v3-entry-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/v3-entry-policy')>();
  return {
    ...actual,
    isV3ScaleInEnabled: vi.fn(() => true),
    resolveMaxTotalExposureUsd: vi.fn((_b: number, fallback: number) => fallback),
    getBinanceMinOrderNotionalUsd: vi.fn(() => 50),
  };
});

import {
  canRunLlmDispatchForSymbol,
} from '../../src/services/v3-entry-eligibility.service';
import {
  getOrCreateTestnetAccount,
  getActiveTestnetPositions,
  getBlockingTestnetPendingOrders,
} from '../../src/repositories/testnet.repository';
import { isV3ScaleInEnabled, resolveMaxTotalExposureUsd } from '../../src/config/v3-entry-policy';

describe('canRunLlmDispatchForSymbol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(true);
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      current_balance: 10000,
    } as never);
  });

  it('allows scale-in when open position under cap', async () => {
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 740 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

    const result = await canRunLlmDispatchForSymbol('BTC');
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('scale-in ok');
  });

  it('blocks when at max exposure', async () => {
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 2000 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

    const result = await canRunLlmDispatchForSymbol('BTC');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('max exposure');
  });

  it('blocks when scale-in disabled and position open', async () => {
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(false);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 700 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

    const result = await canRunLlmDispatchForSymbol('BTC');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('scale-in disabled');
  });

  it('blocks mixed long+short exposure', async () => {
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 400 },
      { side: 'short', size_usd: 300 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

    const result = await canRunLlmDispatchForSymbol('BTC');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('mixed long+short');
  });

  it('blocks scale-in when headroom below Binance min notional', async () => {
    vi.mocked(resolveMaxTotalExposureUsd).mockReturnValue(750);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 736 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      current_balance: 5000,
    } as never);

    const result = await canRunLlmDispatchForSymbol('BTC');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('below Binance min order');
  });
});
