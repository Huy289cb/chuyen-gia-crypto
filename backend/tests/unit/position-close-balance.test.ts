import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCloseTestnetPosition = vi.hoisted(() => vi.fn());
const mockUpdateTestnetPosition = vi.hoisted(() => vi.fn());
const mockRecordTestnetTradeEvent = vi.hoisted(() => vi.fn());
const mockSyncTestnetAccountFromBinance = vi.hoisted(() => vi.fn());
const mockResolveTestnetAccountBalances = vi.hoisted(() => vi.fn());
const mockResolveClosePnlFromUserTrades = vi.hoisted(() => vi.fn());
const mockRecordTradeOutcomeOnClose = vi.hoisted(() => vi.fn());
const mockApplyConsecutiveLossCooldownIfNeeded = vi.hoisted(() => vi.fn());
const mockPrismaUpdate = vi.hoisted(() => vi.fn());

vi.mock('../../src/repositories/testnet.repository', () => ({
  closeTestnetPosition: mockCloseTestnetPosition,
  updateTestnetPosition: mockUpdateTestnetPosition,
  recordTestnetTradeEvent: mockRecordTestnetTradeEvent,
}));

vi.mock('../../src/services/binance-balance-sync.service', () => ({
  syncTestnetAccountFromBinance: mockSyncTestnetAccountFromBinance,
  resolveTestnetAccountBalances: mockResolveTestnetAccountBalances,
}));

vi.mock('../../src/services/binance-fill-pnl.service', () => ({
  resolveClosePnlFromUserTrades: mockResolveClosePnlFromUserTrades,
}));

vi.mock('../../src/services/trade-outcome.service', () => ({
  recordTradeOutcomeOnClose: mockRecordTradeOutcomeOnClose,
}));

vi.mock('../../src/services/account-risk-guard.service', () => ({
  applyConsecutiveLossCooldownIfNeeded: mockApplyConsecutiveLossCooldownIfNeeded,
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: {
      update: mockPrismaUpdate,
    },
  },
}));

import { closeLocalPosition } from '../../src/services/position-close.service';

describe('closeLocalPosition balance updates', () => {
  const basePosition = {
    position_id: 'pos_test',
    account_id: 1,
    side: 'short',
    entry_price: 60000,
    size_qty: 0.01,
    symbol: 'BTC',
    account: { current_balance: 5015.82 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    mockResolveClosePnlFromUserTrades.mockResolvedValue({
      verified: false,
      realizedPnl: -5.5,
      closePrice: 60550,
      source: 'mark_estimate',
      tradeIds: [],
    });
    mockSyncTestnetAccountFromBinance.mockRejectedValue(
      new Error('Binance API Error -1109: Invalid account.')
    );
    mockResolveTestnetAccountBalances.mockResolvedValue({
      account_balance: 5010.32,
      account_equity: 5010.32,
    });
  });

  it('applies local balance delta when Binance sync fails with -1109', async () => {
    await closeLocalPosition(basePosition, 60550, 'stop_loss', {
      verified_binance_zero: true,
    });

    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        current_balance: 5010.32,
        equity: 5010.32,
      }),
    });
    expect(mockSyncTestnetAccountFromBinance).toHaveBeenCalledWith(1);
    expect(mockResolveTestnetAccountBalances).toHaveBeenCalledWith(1, false);
    expect(mockRecordTestnetTradeEvent).toHaveBeenCalledWith(
      'pos_test',
      'position_closed',
      expect.objectContaining({
        account_balance: 5010.32,
        realized_pnl: -5.5,
      })
    );
  });

  it('still applies local delta when BINANCE_ENABLED is false', async () => {
    process.env.BINANCE_ENABLED = 'false';

    await closeLocalPosition(basePosition, 60550, 'manual_close');

    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        current_balance: 5010.32,
        equity: 5010.32,
      }),
    });
    expect(mockSyncTestnetAccountFromBinance).not.toHaveBeenCalled();
  });

  it('bookkeeping close: zero PnL, no wallet/stats update, no trade outcome', async () => {
    await closeLocalPosition(basePosition, 65942, 'reconciliation_closed_not_on_binance', {
      verified_binance_zero: true,
      bookkeeping_close: true,
    });

    expect(mockResolveClosePnlFromUserTrades).not.toHaveBeenCalled();
    expect(mockPrismaUpdate).not.toHaveBeenCalled();
    expect(mockRecordTradeOutcomeOnClose).not.toHaveBeenCalled();
    expect(mockApplyConsecutiveLossCooldownIfNeeded).not.toHaveBeenCalled();
    expect(mockUpdateTestnetPosition).toHaveBeenCalledWith(
      'pos_test',
      expect.objectContaining({ realized_pnl: 0 })
    );
    expect(mockRecordTestnetTradeEvent).toHaveBeenCalledWith(
      'pos_test',
      'position_closed',
      expect.objectContaining({
        realized_pnl: 0,
        close_reason: 'reconciliation_bookkeeping',
        suppress_telegram: true,
        bookkeeping_close: true,
      })
    );
  });

  it('bookkeeping close twice does not double-charge account stats', async () => {
    const posA = { ...basePosition, position_id: 'pos_a' };
    const posB = { ...basePosition, position_id: 'pos_b' };

    await closeLocalPosition(posA, 65942, 'reconciliation_closed_not_on_binance', {
      verified_binance_zero: true,
      bookkeeping_close: true,
    });
    await closeLocalPosition(posB, 65942, 'reconciliation_closed_not_on_binance', {
      verified_binance_zero: true,
      bookkeeping_close: true,
    });

    expect(mockPrismaUpdate).not.toHaveBeenCalled();
    expect(mockRecordTradeOutcomeOnClose).not.toHaveBeenCalled();
  });

  it('proven Binance fill uses userTrades path instead of bookkeeping', async () => {
    mockResolveClosePnlFromUserTrades.mockResolvedValue({
      verified: true,
      realizedPnl: -12.34,
      closePrice: 66830,
      source: 'user_trades',
      tradeIds: [999],
      closeQty: 0.01,
    });

    await closeLocalPosition(
      { ...basePosition, binance_order_id: '15243540740' },
      67185,
      'reconciliation_sync_closed_on_binance',
      { verified_binance_zero: true }
    );

    expect(mockResolveClosePnlFromUserTrades).toHaveBeenCalled();
    expect(mockPrismaUpdate).toHaveBeenCalled();
    expect(mockRecordTestnetTradeEvent).toHaveBeenCalledWith(
      'pos_test',
      'position_closed',
      expect.objectContaining({
        realized_pnl: -12.34,
        close_reason: expect.not.stringContaining('bookkeeping'),
      })
    );
    expect(mockRecordTestnetTradeEvent).toHaveBeenCalledWith(
      'pos_test',
      'position_closed',
      expect.not.objectContaining({ suppress_telegram: true })
    );
  });

  it('reconciliation_closed_not_on_binance with binance_order_id is not bookkeeping', async () => {
    mockResolveClosePnlFromUserTrades.mockResolvedValue({
      verified: true,
      realizedPnl: 5.5,
      closePrice: 67200,
      source: 'user_trades',
      tradeIds: [1],
      closeQty: 0.01,
    });

    await closeLocalPosition(
      { ...basePosition, binance_order_id: '15243540740' },
      67185,
      'reconciliation_closed_not_on_binance',
      { verified_binance_zero: true }
    );

    expect(mockResolveClosePnlFromUserTrades).toHaveBeenCalled();
    expect(mockRecordTestnetTradeEvent).toHaveBeenCalledWith(
      'pos_test',
      'position_closed',
      expect.objectContaining({ realized_pnl: 5.5 })
    );
  });
});
