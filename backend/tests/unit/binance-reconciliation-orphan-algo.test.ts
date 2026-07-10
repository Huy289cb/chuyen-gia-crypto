import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getTestnetPendingOrders: vi.fn().mockResolvedValue([]),
  updateTestnetPendingOrder: vi.fn(),
  getTestnetPositions: vi.fn(),
  updateTestnetPosition: vi.fn(),
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchActiveBinancePositions: vi.fn(),
  fetchBinancePositionRiskRows: vi.fn(),
  inferBinancePositionsFromFallback: vi.fn(),
  isBinancePositionRiskUnavailable: vi.fn(),
}));

vi.mock('../../src/services/binanceClient', () => ({
  getOpenOrders: vi.fn().mockResolvedValue([]),
  getOpenAlgoOrders: vi.fn(),
  cancelAlgoOrder: vi.fn(),
}));

import { getTestnetPositions } from '../../src/repositories/testnet.repository';
import {
  fetchActiveBinancePositions,
  isBinancePositionRiskUnavailable,
} from '../../src/services/binance-exposure.service';
import { getOpenAlgoOrders, cancelAlgoOrder } from '../../src/services/binanceClient';
import { cleanupOrphanBinanceAlgoOrders } from '../../src/services/binance-reconciliation';

describe('cleanupOrphanBinanceAlgoOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTestnetPositions).mockResolvedValue([]);
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([]);
    vi.mocked(isBinancePositionRiskUnavailable).mockReturnValue(false);
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: '1001', orderType: 'STOP_MARKET' },
      { algoId: '1002', orderType: 'TAKE_PROFIT_MARKET' },
    ]);
  });

  it('skips cleanup when local open positions exist for symbol', async () => {
    vi.mocked(getTestnetPositions).mockResolvedValue([
      {
        position_id: 'pos-1',
        symbol: 'BTC',
        side: 'short',
        status: 'open',
        binance_sl_order_id: '1001',
        binance_tp_order_id: '1002',
      },
    ] as never);

    const cancelled = await cleanupOrphanBinanceAlgoOrders('BTC');

    expect(cancelled).toBe(0);
    expect(cancelAlgoOrder).not.toHaveBeenCalled();
  });

  it('skips cleanup when demo positionRisk is unavailable and fallback is empty', async () => {
    vi.mocked(isBinancePositionRiskUnavailable).mockReturnValue(true);
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([]);

    const cancelled = await cleanupOrphanBinanceAlgoOrders('BTC');

    expect(cancelled).toBe(0);
    expect(cancelAlgoOrder).not.toHaveBeenCalled();
  });

  it('skips cleanup when Binance still has exposure', async () => {
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([
      {
        symbol: 'BTC',
        symbolUsdt: 'BTCUSDT',
        side: 'short',
        positionAmt: 0.0119,
        entryPrice: 62904.9,
        markPrice: 62904.9,
        rawPositionSide: 'BOTH',
      },
    ]);

    const cancelled = await cleanupOrphanBinanceAlgoOrders('BTC');

    expect(cancelled).toBe(0);
    expect(cancelAlgoOrder).not.toHaveBeenCalled();
  });

  it('cancels algos only when no local open row and no Binance exposure', async () => {
    const cancelled = await cleanupOrphanBinanceAlgoOrders('BTC');

    expect(cancelled).toBe(2);
    expect(cancelAlgoOrder).toHaveBeenCalledTimes(2);
  });
});
