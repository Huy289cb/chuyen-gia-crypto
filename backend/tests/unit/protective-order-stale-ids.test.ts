import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  updateTestnetPosition: vi.fn(),
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/binanceClient', () => ({
  getOpenAlgoOrders: vi.fn(),
  placeStopLossOrder: vi.fn(),
  placeTakeProfitOrder: vi.fn(),
}));

vi.mock('../../src/services/binance-hedge-mode', () => ({
  ensurePositionModeDetected: vi.fn(),
  getPositionMode: vi.fn().mockReturnValue('ONE_WAY'),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchBinanceNetPosition: vi.fn().mockResolvedValue({
    markPrice: 62000,
    side: 'long',
    positionAmt: 0.01,
  }),
}));

vi.mock('../../src/services/position-close.service', () => ({
  closePositionOnBinanceMarket: vi.fn(),
  closeLocalPosition: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetPosition: {
      findUnique: vi.fn(),
    },
  },
}));

import { updateTestnetPosition } from '../../src/repositories/testnet.repository';
import {
  getOpenAlgoOrders,
  placeStopLossOrder,
  placeTakeProfitOrder,
} from '../../src/services/binanceClient';
import {
  extractOpenAlgoOrderIds,
  reconcileStaleProtectiveOrderIds,
  placeProtectiveOrdersForPosition,
} from '../../src/services/protective-order.service';

describe('extractOpenAlgoOrderIds', () => {
  it('collects algoId and orderId from open algo rows', () => {
    const ids = extractOpenAlgoOrderIds([
      { algoId: '9001', orderType: 'STOP_MARKET' },
      { orderId: '9002', orderType: 'TAKE_PROFIT_MARKET' },
    ]);
    expect(ids).toEqual(new Set(['9001', '9002']));
  });
});

describe('reconcileStaleProtectiveOrderIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears stale SL/TP ids when openAlgoOrders is empty', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);

    const result = await reconcileStaleProtectiveOrderIds({
      position_id: 'pos_test',
      symbol: 'BTC',
      binance_sl_order_id: 'old_sl',
      binance_tp_order_id: 'old_tp',
    });

    expect(result.clearedSl).toBe(true);
    expect(result.clearedTp).toBe(true);
    expect(result.binance_sl_order_id).toBeNull();
    expect(result.binance_tp_order_id).toBeNull();
    expect(updateTestnetPosition).toHaveBeenCalledWith('pos_test', {
      binance_sl_order_id: null,
      binance_tp_order_id: null,
    });
  });

  it('keeps ids that still exist on Binance', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: 'live_sl', orderType: 'STOP_MARKET' },
      { algoId: 'live_tp', orderType: 'TAKE_PROFIT_MARKET' },
    ]);

    const result = await reconcileStaleProtectiveOrderIds({
      position_id: 'pos_test',
      symbol: 'BTC',
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: 'live_tp',
    });

    expect(result.clearedSl).toBe(false);
    expect(result.clearedTp).toBe(false);
    expect(updateTestnetPosition).not.toHaveBeenCalled();
  });

  it('clears only the stale id when one still exists', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: 'live_sl', orderType: 'STOP_MARKET' },
    ]);

    const result = await reconcileStaleProtectiveOrderIds({
      position_id: 'pos_test',
      symbol: 'BTC',
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: 'gone_tp',
    });

    expect(result.clearedSl).toBe(false);
    expect(result.clearedTp).toBe(true);
    expect(updateTestnetPosition).toHaveBeenCalledWith('pos_test', {
      binance_tp_order_id: null,
    });
  });
});

describe('placeProtectiveOrdersForPosition stale ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);
    vi.mocked(placeStopLossOrder).mockResolvedValue({ orderId: 'new_sl' });
    vi.mocked(placeTakeProfitOrder).mockResolvedValue({ orderId: 'new_tp' });
  });

  it('re-places SL/TP when DB has stale ids and openAlgoOrders is empty', async () => {
    const outcome = await placeProtectiveOrdersForPosition({
      position_id: 'pos_1780935622791_pn99g9',
      symbol: 'BTC',
      side: 'long',
      entry_price: 63000,
      size_qty: 0.01,
      stop_loss: 62500,
      take_profit: 64000,
      binance_sl_order_id: 'stale_sl',
      binance_tp_order_id: 'stale_tp',
    });

    expect(outcome).toBe('ok');
    expect(updateTestnetPosition).toHaveBeenCalledWith(
      'pos_1780935622791_pn99g9',
      expect.objectContaining({ binance_sl_order_id: null, binance_tp_order_id: null })
    );
    expect(placeStopLossOrder).toHaveBeenCalled();
    expect(placeTakeProfitOrder).toHaveBeenCalled();
  });

  it('skips when both ids are live on Binance', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: 'live_sl' },
      { algoId: 'live_tp' },
    ]);

    const outcome = await placeProtectiveOrdersForPosition({
      position_id: 'pos_ok',
      symbol: 'BTC',
      side: 'long',
      entry_price: 63000,
      size_qty: 0.01,
      stop_loss: 62500,
      take_profit: 64000,
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: 'live_tp',
    });

    expect(outcome).toBe('skipped');
    expect(placeStopLossOrder).not.toHaveBeenCalled();
    expect(placeTakeProfitOrder).not.toHaveBeenCalled();
  });
});
