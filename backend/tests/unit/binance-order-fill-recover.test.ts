import {replayRecordedMaterializationGate} from '../../src/utils/recorded-materialization-gate';
import { prisma } from '../../src/lib/prisma';
import { placeProtectiveOrdersForPosition } from '../../src/services/protective-order.service';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const mockUpdatePending = vi.hoisted(() => vi.fn());
const mockExecutePending = vi.hoisted(() => vi.fn());
const mockCreatePosition = vi.hoisted(() => vi.fn());
const mockFindByBinanceId = vi.hoisted(() => vi.fn());
const mockRecordSilent = vi.hoisted(() => vi.fn());
const mockRecordEvent = vi.hoisted(() => vi.fn());
const mockFindFirstPosition = vi.hoisted(() => vi.fn());
const mockFindUniquePosition = vi.hoisted(() => vi.fn());
const mockFetchActiveBinancePositions = vi.hoisted(() => vi.fn());
const getOrder = vi.hoisted(() => vi.fn());
const cancelOrder = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/testnet.repository', () => ({
  updateTestnetPendingOrder: mockUpdatePending,
  executeTestnetPendingOrder: mockExecutePending,
  createTestnetPosition: mockCreatePosition,
  findTestnetPositionByBinanceOrderId: mockFindByBinanceId,
  getTestnetPendingOrderByBinanceId: vi.fn(),
  recordTestnetTradeEvent: mockRecordEvent,
  recordSilentPipelineEvent: mockRecordSilent,
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
  fetchActiveBinancePositions: mockFetchActiveBinancePositions,
}));

vi.mock('../../src/services/binance/trading', () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
  cancelOrder: (...args: unknown[]) => cancelOrder(...args),
}));

import {
  RECOVERY_FILL_MAX_AGE_MS,
  recoverPendingOrderFromBinance,
  materializePositionFromPendingFill,
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
    mockFetchActiveBinancePositions.mockResolvedValue([]);
    cancelOrder.mockReset();
    cancelOrder.mockResolvedValue({ status: 'CANCELED' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes simultaneous websocket and polling materialization for the same fill', async () => {
    let stored: { position_id: string } | null = null;
    mockFindByBinanceId.mockImplementation(async () => stored);
    mockCreatePosition.mockImplementation(async position => { await Promise.resolve(); stored = { position_id: position.positionId }; });
    mockFetchActiveBinancePositions.mockResolvedValue([{ symbol: 'BTC', side: 'long', positionAmt: 0.001, entryPrice: 64000 }]);
    const results = await Promise.all([
      materializePositionFromPendingFill(baseOrder, 0.001, 64000, now),
      materializePositionFromPendingFill(baseOrder, 0.001, 64000, now),
    ]);
    expect(results[0]).toMatch(/^pos_/);
    expect(results[1]).toBe(results[0]);
    expect(mockCreatePosition).toHaveBeenCalledOnce();
  });

  it('releases serialization after creation fails so reconciliation can retry', async () => {
    mockCreatePosition.mockRejectedValueOnce(new Error('DB unavailable'));
    mockFetchActiveBinancePositions.mockResolvedValue([{ symbol: 'BTC', side: 'long', positionAmt: 0.001, entryPrice: 64000 }]);
    await expect(materializePositionFromPendingFill(baseOrder, 0.001, 64000, now)).rejects.toThrow('DB unavailable');
    expect(await materializePositionFromPendingFill(baseOrder, 0.001, 64000, now)).toMatch(/^pos_/);
    expect(mockCreatePosition).toHaveBeenCalledTimes(2);
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

  it.each(['CANCELED', 'EXPIRED', 'REJECTED'])('recovers executed exposure after terminal %s', async status => {
    getOrder.mockResolvedValue({ status, executedQty: 0.001,
      cummulativeQuoteQty: 64, price: 64000, updateTime: now - 60_000 });
    mockFetchActiveBinancePositions.mockResolvedValue([{ symbol: 'BTC', symbolUsdt: 'BTCUSDT',
      side: 'long', positionAmt: 0.001, entryPrice: 64000, markPrice: 64010, rawPositionSide: 'BOTH' }]);
    mockFindUniquePosition.mockResolvedValueOnce({ position_id: 'recovered', size_qty: 0.001 });
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('filled');
    expect(mockCreatePosition).toHaveBeenCalledWith(expect.objectContaining({ sizeQty: 0.001, entryPrice: 64000 }));
    expect(mockExecutePending).toHaveBeenCalledOnce();
    expect(placeProtectiveOrdersForPosition).toHaveBeenCalledWith(expect.objectContaining({ size_qty: 0.001 }));
    expect(mockUpdatePending).not.toHaveBeenCalled();
  });

  it('does not reopen stale cancelled partial exposure when Binance is flat', async () => {
    getOrder.mockResolvedValue({ status: 'CANCELED', executedQty: 0.001,
      cummulativeQuoteQty: 64, price: 64000, updateTime: now - RECOVERY_FILL_MAX_AGE_MS - 1000 });
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('stale_skipped');
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockUpdatePending).toHaveBeenCalledWith('v3_test', expect.objectContaining({
      status: 'executed_historical', executed_size_qty: 0.001 }));
  });

  it.each(['CANCELED', 'FILLED'])('seals partial remainder and protects final cumulative quantity after %s race', async status => {
    getOrder.mockResolvedValueOnce({ orderId: 999, symbol: 'BTCUSDT', status: 'PARTIALLY_FILLED', executedQty: 0.001 });
    getOrder.mockResolvedValueOnce({ orderId: 999, symbol: 'BTCUSDT', status, executedQty: 0.002,
      cummulativeQuoteQty: 128, price: 64000, updateTime: now });
    if (status === 'FILLED') cancelOrder.mockRejectedValueOnce(new Error('Already filled'));
    mockFetchActiveBinancePositions.mockResolvedValue([{ symbol: 'BTC', symbolUsdt: 'BTCUSDT',
      side: 'long', positionAmt: 0.002, entryPrice: 64000, markPrice: 64010, rawPositionSide: 'BOTH' }]);
    mockFindUniquePosition.mockResolvedValueOnce({ position_id: 'recovered', size_qty: 0.002 });
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('filled');
    expect(mockRecordSilent).toHaveBeenCalledWith('partial_fill_requery',expect.objectContaining({
      schema:'partial-fill-requery-v1',exchange_order_id:'999',
      initial:expect.objectContaining({executedQty:.001,status:'PARTIALLY_FILLED'}),
      final:expect.objectContaining({executedQty:.002,status}),
    }));
    expect(cancelOrder).toHaveBeenCalledWith('BTCUSDT', 999);
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(mockCreatePosition).toHaveBeenCalledWith(expect.objectContaining({ sizeQty: 0.002 }));
    expect(placeProtectiveOrdersForPosition).toHaveBeenCalledWith(expect.objectContaining({ size_qty: 0.002 }));
    expect(mockUpdatePending).not.toHaveBeenCalled();
  });

  it('keeps occupancy unchanged when cancellation failed and partial entry remains open', async () => {
    getOrder.mockResolvedValue({ orderId: 999, symbol: 'BTCUSDT', status: 'PARTIALLY_FILLED', executedQty: 0.001 });
    cancelOrder.mockRejectedValueOnce(new Error('timeout'));
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('unchanged');
    expect(mockUpdatePending).not.toHaveBeenCalled();
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockExecutePending).not.toHaveBeenCalled();
  });

  it.each([
    { orderId: 999, symbol: 'BTCUSDT', executedQty: 0.0005 },
    { orderId: 1000, symbol: 'BTCUSDT', executedQty: 0.001 },
    { orderId: 999, symbol: 'ETHUSDT', executedQty: 0.001 },
    { orderId: 999, symbol: 'BTCUSDT', executedQty: NaN },
  ])('does not release or materialize from inconsistent final partial evidence %j', async final => {
    getOrder.mockResolvedValueOnce({ orderId: 999, symbol: 'BTCUSDT', status: 'PARTIALLY_FILLED', executedQty: 0.001 });
    getOrder.mockResolvedValueOnce({ status: 'CANCELED', ...final });
    expect(await recoverPendingOrderFromBinance(baseOrder)).toBe('failed');
    expect(mockUpdatePending).not.toHaveBeenCalled();
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockExecutePending).not.toHaveBeenCalled();
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

  it('old FILLED with active Binance exposure materializes position for protective recovery', async () => {
    const fillTime = now - RECOVERY_FILL_MAX_AGE_MS - 1000;
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64530,
      price: 64530,
      updateTime: fillTime,
    });
    mockFetchActiveBinancePositions.mockResolvedValue([
      {
        symbol: 'BTC',
        symbolUsdt: 'BTCUSDT',
        side: 'long',
        positionAmt: 0.0115,
        entryPrice: 64530,
        markPrice: 64540,
        rawPositionSide: 'BOTH',
      },
    ]);

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('filled');
    expect(mockCreatePosition).toHaveBeenCalledOnce();
    expect(mockCreatePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPrice: 64530,
        sizeQty: 0.0115,
      })
    );
    expect(mockExecutePending).toHaveBeenCalledWith('v3_test', expect.stringMatching(/^pos_/));
    const gateRows=mockRecordSilent.mock.calls.filter(c=>c[0]==='materialization_gate_evaluated').map(c=>c[1]);
    expect(gateRows.map(r=>r.stage)).toEqual(['price','exposure_quantity']);
    expect(new Set(gateRows.map(r=>r.materialization_attempt_id)).size).toBe(1);
    for(const row of gateRows)expect(replayRecordedMaterializationGate(JSON.parse(JSON.stringify(row)),Date.now())).toMatchObject({status:'evaluated',matches_recorded:true});
    expect(mockUpdatePending).not.toHaveBeenCalledWith(
      'v3_test',
      expect.objectContaining({ status: 'executed_historical' })
    );
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

  it('fresh FILLED: materializes position and restores durable trace without an in-memory dispatch', async () => {
    vi.mocked(prisma.testnetTradeEvent.findMany).mockResolvedValueOnce([{event_data:JSON.stringify({
      order_id:'v3_test',decision_id:997,trace_id:'persisted-trace',observation_key:'BTC:15m:bar',code_hash:'build',
    })} as any]);
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64000,
      price: 64000,
      updateTime: now - 60_000,
    });
    mockFetchActiveBinancePositions.mockResolvedValue([
      {
        symbol: 'BTC',
        symbolUsdt: 'BTCUSDT',
        side: 'long',
        positionAmt: 0.0115,
        entryPrice: 64000,
        markPrice: 64010,
        rawPositionSide: 'BOTH',
      },
    ]);

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('filled');
    expect(mockCreatePosition).toHaveBeenCalledOnce();
    expect(mockExecutePending).toHaveBeenCalled();
    expect(prisma.testnetTradeEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where:expect.objectContaining({event_type:'pending_order_linked',event_data:{contains:'"order_id":"v3_test"'}}),take:1,
    }));
    expect(mockRecordEvent).toHaveBeenCalledWith(expect.any(String),'entry_order_filled',expect.objectContaining({
      trace_id:'persisted-trace',decision_id:997,observation_key:'BTC:15m:bar',linkage_status:'linked',code_hash:'build',
    }));
    expect(mockUpdatePending).not.toHaveBeenCalledWith(
      'v3_test',
      expect.objectContaining({ status: 'executed_historical' })
    );
  });

  it('fresh FILLED but no live Binance exposure → stale_skipped', async () => {
    getOrder.mockResolvedValue({
      status: 'FILLED',
      executedQty: 0.0115,
      cummulativeQuoteQty: 0.0115 * 64000,
      price: 64000,
      updateTime: now - 60_000,
    });
    mockFetchActiveBinancePositions.mockResolvedValue([]);

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('stale_skipped');
    expect(mockCreatePosition).not.toHaveBeenCalled();
    expect(mockUpdatePending).toHaveBeenCalledWith(
      'v3_test',
      expect.objectContaining({
        status: 'executed_historical',
        close_reason: 'fill_no_live_exposure',
      })
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
