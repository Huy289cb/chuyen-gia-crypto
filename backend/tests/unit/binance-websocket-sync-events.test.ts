import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateTestnetPendingOrder = vi.hoisted(() => vi.fn());
const mockRecordPipelineEvent = vi.hoisted(() => vi.fn());
const mockFindLocalOrderForBinanceEvent = vi.hoisted(() => vi.fn());
const mockMaterializePositionFromPendingFill = vi.hoisted(() => vi.fn());
const mockCloseOpenPositionFromBinanceFill = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/testnet.repository', () => ({
  updateTestnetPendingOrder: mockUpdateTestnetPendingOrder,
  recordPipelineEvent: mockRecordPipelineEvent,
}));

vi.mock('../../src/services/binance-order-fill.service', () => ({
  findLocalOrderForBinanceEvent: mockFindLocalOrderForBinanceEvent,
  materializePositionFromPendingFill: mockMaterializePositionFromPendingFill,
  resolveFillAvgPrice: (order: { ap?: string; L?: string }, _qty: number, fallback = 0) =>
    Number(order.ap ?? order.L ?? fallback),
  resolveFillQty: (order: { z?: string; l?: string }, fallback = 0) =>
    Number(order.z ?? order.l ?? fallback),
}));

vi.mock('../../src/services/position-close.service', () => ({
  closeOpenPositionFromBinanceFill: mockCloseOpenPositionFromBinanceFill,
  syncClosedPositionsFromAccountUpdate: vi.fn(),
}));

vi.mock('../../src/services/binance/stream', () => ({
  startListenKey: vi.fn(),
  keepAliveListenKey: vi.fn(),
  closeListenKey: vi.fn(),
}));

vi.mock('../../src/services/telegram/telegram-hooks', () => ({
  hookPendingCancelled: vi.fn(),
}));

vi.mock('../../src/services/pending-order-actions', () => ({
  isPendingOrderTerminal: vi.fn().mockReturnValue(false),
}));

import { handleOrderTradeUpdate } from '../../src/services/binance-websocket-sync';

describe('binance websocket trade events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLocalOrderForBinanceEvent.mockResolvedValue({
      order_id: 'pending_1',
      binance_order_id: '12345',
      symbol: 'BTC',
      entry_price: 61000,
      status: 'pending',
    });
    mockRecordPipelineEvent.mockResolvedValue(1);
    mockCloseOpenPositionFromBinanceFill.mockResolvedValue(true);
  });

  it('records partial fills on the pipeline anchor instead of using pending order id as position id', async () => {
    await handleOrderTradeUpdate({
      E: Date.parse('2026-07-02T14:00:00.000Z'),
      o: {
        i: 12345,
        X: 'PARTIALLY_FILLED',
        s: 'BTCUSDT',
        o: 'LIMIT',
        z: '0.005',
        ap: '61020',
        c: 'client_pending_1',
      },
    });

    expect(mockUpdateTestnetPendingOrder).toHaveBeenCalledWith(
      'pending_1',
      expect.objectContaining({
        status: 'partially_filled',
        executed_size_qty: 0.005,
        executed_size_usd: 305.1,
        executed_price: 61020,
      })
    );
    expect(mockRecordPipelineEvent).toHaveBeenCalledWith(
      'partial_fill',
      expect.objectContaining({
        order_id: 'pending_1',
        binance_order_id: '12345',
        symbol: 'BTC',
        executed_qty: 0.005,
        avg_price: 61020,
        suppress_telegram: true,
      })
    );
  });

  it('records unlinked algo fills on the pipeline anchor instead of position id "unknown"', async () => {
    mockFindLocalOrderForBinanceEvent.mockResolvedValue(null);
    mockCloseOpenPositionFromBinanceFill.mockResolvedValue(false);

    await handleOrderTradeUpdate({
      E: Date.parse('2026-07-02T14:05:00.000Z'),
      o: {
        i: 999,
        X: 'FILLED',
        s: 'BTCUSDT',
        o: 'STOP_MARKET',
        z: '0.01',
        ap: '60800',
      },
    });

    expect(mockCloseOpenPositionFromBinanceFill).toHaveBeenCalledWith(
      '999',
      'STOP_MARKET',
      0.01,
      60800,
      'BTCUSDT'
    );
    expect(mockRecordPipelineEvent).toHaveBeenCalledWith(
      'algo_order_filled',
      expect.objectContaining({
        binance_order_id: '999',
        order_type: 'STOP_MARKET',
        symbol: 'BTCUSDT',
        executed_qty: 0.01,
        avg_price: 60800,
        position_closed: false,
      })
    );
  });
});
