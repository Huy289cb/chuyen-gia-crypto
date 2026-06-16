import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const mockUpdatePending = vi.hoisted(() => vi.fn());
const mockExecutePending = vi.hoisted(() => vi.fn());
const mockCreatePosition = vi.hoisted(() => vi.fn());
const mockFindByBinanceId = vi.hoisted(() => vi.fn());
const mockRecordEvent = vi.hoisted(() => vi.fn());
const mockFindFirstPosition = vi.hoisted(() => vi.fn());
const mockFindUniquePosition = vi.hoisted(() => vi.fn());
const getOrder = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/testnet.repository', () => ({
  updateTestnetPendingOrder: mockUpdatePending,
  executeTestnetPendingOrder: mockExecutePending,
  createTestnetPosition: mockCreatePosition,
  findTestnetPositionByBinanceOrderId: mockFindByBinanceId,
  getTestnetPendingOrderByBinanceId: vi.fn(),
  recordTestnetTradeEvent: mockRecordEvent,
  PIPELINE_EVENT_POSITION_ID: 'pipeline',
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetPosition: {
      findFirst: mockFindFirstPosition,
      findUnique: mockFindUniquePosition,
    },
    testnetTradeEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../../src/services/protective-order.service', () => ({
  placeProtectiveOrdersForPosition: vi.fn(),
  resolveLevelsForFill: vi.fn().mockReturnValue({ stop_loss: 63000, take_profit: 66000 }),
}));

vi.mock('../../src/services/binance-balance-sync.service', () => ({
  resolveTestnetAccountBalances: vi.fn().mockResolvedValue({
    account_balance: 5000,
    account_equity: 5000,
  }),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchBinanceNetPosition: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/binance/trading', () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
}));

import {
  RECOVERY_FILL_MAX_AGE_MS,
  recoverPendingOrderFromBinance,
} from '../../src/services/binance-order-fill.service';

describe('recoverPendingOrderFromBinance — sync rules', () => {
  const now = new Date('2026-06-15T12:00:00.000Z').getTime();

  const baseOrder = {
    order_id: 'v3_test',
    account_id: 1,
    symbol: 'BTC',
    side: 'long',
    entry_price: 64000,
    stop_loss: 63000,
    take_profit: 66000,
    risk_usd: 50,
    risk_percent: 1,
    expected_rr: 2,
    binance_order_id: '999',
    status: 'pending',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    mockFindByBinanceId.mockResolvedValue(null);
    mockFindFirstPosition.mockResolvedValue(null);
    mockCreatePosition.mockResolvedValue(undefined);
    mockExecutePending.mockResolvedValue(undefined);
    mockUpdatePending.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns failed when binance_order_id missing', async () => {
    const outcome = await recoverPendingOrderFromBinance({
      ...baseOrder,
      binance_order_id: null,
    });
    expect(outcome).toBe('failed');
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('returns api_unavailable on demo -1109', async () => {
    getOrder.mockRejectedValue(new Error('Binance API Error -1109: Invalid account.'));
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('api_unavailable');
    expect(mockCreatePosition).not.toHaveBeenCalled();
  });

  it('returns cancelled when Binance reports CANCELED', async () => {
    getOrder.mockResolvedValue({
      status: 'CANCELED',
      executedQty: 0,
      cummulativeQuoteQty: 0,
      price: 64000,
    });
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('cancelled');
    expect(mockUpdatePending).toHaveBeenCalledWith('v3_test', { status: 'canceled' });
    expect(mockCreatePosition).not.toHaveBeenCalled();
  });

  it('stale_skipped: FILLED older than 15min → executed_historical, no position', async () => {
    const fillTime = now - RECOVERY_FILL_MAX_AGE_MS - 1000;
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64530,
      price: 64530,
      updateTime: fillTime,
    });

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('stale_skipped');
    expect(mockUpdatePending).toHaveBeenCalledWith('v3_test', {
      status: 'executed_historical',
      executed_at: expect.any(Date),
      executed_price: 64530,
      executed_size_qty: 0.0115,
      close_reason: 'fill_too_old',
    });
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockExecutePending).not.toHaveBeenCalled();
  });

  it('stale_skipped: FILLED without updateTime treated as infinitely old', async () => {
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.01,
      cummulativeQuoteQty: 640,
      price: 64000,
    });

    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('stale_skipped');
    expect(mockCreatePosition).not.toHaveBeenCalled();
  });

  it('fresh FILLED: materializes position when no open row exists', async () => {
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64000,
      price: 64000,
      updateTime: now - 60_000,
    });

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('filled');
    expect(mockCreatePosition).toHaveBeenCalledOnce();
    expect(mockExecutePending).toHaveBeenCalled();
    expect(mockUpdatePending).not.toHaveBeenCalledWith(
      'v3_test',
      expect.objectContaining({ status: 'executed_historical' })
    );
  });

  it('fresh FILLED but open position exists → stale_skipped, links pending only', async () => {
    mockFindFirstPosition.mockResolvedValue({ position_id: 'pos_existing' });
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64000,
      price: 64000,
      updateTime: now - 60_000,
    });

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('stale_skipped');
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockExecutePending).toHaveBeenCalledWith('v3_test', 'pos_existing');
    expect(mockUpdatePending).not.toHaveBeenCalled();
  });

  it('position already exists for binance_order_id → links pending, no duplicate create', async () => {
    mockFindByBinanceId.mockResolvedValue({ position_id: 'pos_from_ws' });
    mockFindUniquePosition.mockResolvedValue({
      position_id: 'pos_from_ws',
      entry_price: 64000,
    });
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64000,
      price: 64000,
      updateTime: now - 60_000,
    });

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('filled');
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockExecutePending).toHaveBeenCalledWith('v3_test', 'pos_from_ws');
  });

  it('prevents burst: two stale shorts only mark ledger, never create positions', async () => {
    const fillTime = now - 3 * 24 * 60 * 60 * 1000;
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0119,
      cummulativeQuoteQty: 0.0119 * 62940,
      price: 62940,
      updateTime: fillTime,
    });

    const shortA = { ...baseOrder, order_id: 'v3_short_a', side: 'short', entry_price: 62940 };
    const shortB = { ...baseOrder, order_id: 'v3_short_b', side: 'short', entry_price: 62950, binance_order_id: '1000' };

    expect(await recoverPendingOrderFromBinance(shortA)).toBe('stale_skipped');
    expect(await recoverPendingOrderFromBinance(shortB)).toBe('stale_skipped');

    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockUpdatePending).toHaveBeenCalledTimes(2);
    expect(mockUpdatePending).toHaveBeenCalledWith(
      'v3_short_a',
      expect.objectContaining({ status: 'executed_historical', close_reason: 'fill_too_old' })
    );
  });

  it('returns unchanged for NEW limit still on book', async () => {
    getOrder.mockResolvedValue({
      status: 'NEW',
      executedQty: 0,
      price: 64000,
      updateTime: now,
    });

    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('unchanged');
    expect(mockUpdatePending).toHaveBeenCalledWith('v3_test', { status: 'pending' });
    expect(mockCreatePosition).not.toHaveBeenCalled();
  });
});
