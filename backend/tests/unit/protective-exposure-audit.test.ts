import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindFirstPosition = vi.hoisted(() => vi.fn());
const mockFetchActiveBinancePositions = vi.hoisted(() => vi.fn());
const mockGetOpenAlgoOrders = vi.hoisted(() => vi.fn());
const mockClosePositionOnBinanceMarket = vi.hoisted(() => vi.fn());
const mockPlaceProtectiveOrdersForPosition = vi.hoisted(() => vi.fn());
const mockRecordPipelineEvent = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetPosition: {
      findFirst: mockFindFirstPosition,
    },
  },
}));

vi.mock('../../src/repositories/testnet.repository', () => ({
  PIPELINE_EVENT_POSITION_ID: 'pipeline_v3_kim_nghia',
  ensurePipelineEventPosition: vi.fn(),
  getOrCreateTestnetAccount: vi.fn().mockResolvedValue({ id: 1 }),
  recordPipelineEvent: mockRecordPipelineEvent,
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchActiveBinancePositions: mockFetchActiveBinancePositions,
}));

vi.mock('../../src/services/binanceClient', () => ({
  getOpenAlgoOrders: mockGetOpenAlgoOrders,
}));

vi.mock('../../src/services/position-close.service', () => ({
  closePositionOnBinanceMarket: mockClosePositionOnBinanceMarket,
}));

vi.mock('../../src/services/protective-order.service', () => ({
  placeProtectiveOrdersForPosition: mockPlaceProtectiveOrdersForPosition,
}));

vi.mock('../../src/services/telegram/telegram-notify.service', () => ({
  notifyAlert: vi.fn(),
}));

import {
  auditProtectiveCoverageForSymbol,
  classifyProtectiveCoverage,
} from '../../src/services/protective-exposure-audit.service';
import {
  clearProtectiveExposureEntryBlock,
  getProtectiveExposureEntryBlock,
} from '../../src/services/protective-exposure-state';

describe('protective exposure audit', () => {
  const activeLong = {
    symbol: 'BTC',
    symbolUsdt: 'BTCUSDT',
    side: 'long' as const,
    positionAmt: 0.01,
    entryPrice: 63000,
    markPrice: 63100,
    rawPositionSide: 'BOTH',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    process.env.PROTECTIVE_EXPOSURE_AUDIT_ENABLED = 'true';
    clearProtectiveExposureEntryBlock();
    mockFetchActiveBinancePositions.mockResolvedValue([activeLong]);
    mockGetOpenAlgoOrders.mockResolvedValue([]);
    mockFindFirstPosition.mockResolvedValue(null);
    mockClosePositionOnBinanceMarket.mockResolvedValue({ ok: true });
    mockPlaceProtectiveOrdersForPosition.mockResolvedValue('ok');
  });

  it('classifies matching SL and TP algos for a live position', () => {
    const coverage = classifyProtectiveCoverage(activeLong, [
      { symbol: 'BTCUSDT', side: 'SELL', orderType: 'STOP_MARKET', algoId: 'sl1' },
      { symbol: 'BTCUSDT', side: 'SELL', orderType: 'TAKE_PROFIT_MARKET', algoId: 'tp1' },
      { symbol: 'BTCUSDT', side: 'BUY', orderType: 'STOP_MARKET', algoId: 'wrong_side' },
    ]);

    expect(coverage.stopLossId).toBe('sl1');
    expect(coverage.takeProfitId).toBe('tp1');
  });

  it('closes untracked exposure when SL is missing', async () => {
    const result = await auditProtectiveCoverageForSymbol('BTC');

    expect(result.closed).toBe(1);
    expect(result.blocked).toBe(false);
    expect(mockClosePositionOnBinanceMarket).toHaveBeenCalledWith({
      symbol: 'BTC',
      side: 'long',
      size_qty: 0.01,
    });
    expect(mockRecordPipelineEvent).toHaveBeenCalledWith(
      'untracked_exposure_protective_close',
      expect.objectContaining({ reason: 'missing_sl_no_local_position', close_ok: true })
    );
  });

  it('blocks entries when missing-SL emergency close fails', async () => {
    mockClosePositionOnBinanceMarket.mockResolvedValue({
      ok: false,
      reason: 'exchange rejected close',
    });

    const result = await auditProtectiveCoverageForSymbol('BTC');

    expect(result.blocked).toBe(true);
    expect(getProtectiveExposureEntryBlock()?.reason).toContain('missing SL');
  });

  it('repairs a local position missing TP when SL exists', async () => {
    mockGetOpenAlgoOrders.mockResolvedValue([
      { symbol: 'BTCUSDT', side: 'SELL', orderType: 'STOP_MARKET', algoId: 'sl1' },
    ]);
    mockFindFirstPosition.mockResolvedValue({
      position_id: 'pos_live',
      symbol: 'BTC',
      side: 'long',
      status: 'open',
      size_qty: 0.01,
    });

    const result = await auditProtectiveCoverageForSymbol('BTC');

    expect(result.repaired).toBe(1);
    expect(mockPlaceProtectiveOrdersForPosition).toHaveBeenCalledWith(
      expect.objectContaining({ position_id: 'pos_live' })
    );
    expect(getProtectiveExposureEntryBlock()).toBeNull();
  });
});
