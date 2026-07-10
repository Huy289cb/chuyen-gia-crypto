import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnqueue = vi.hoisted(() => vi.fn());
const mockIsTelegramEnabled = vi.hoisted(() => vi.fn(() => true));
const mockShouldNotifyTrades = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../src/config/telegram', () => ({
  isTelegramEnabled: mockIsTelegramEnabled,
  shouldNotifyRisk: vi.fn(() => true),
  shouldNotifyTrades: mockShouldNotifyTrades,
  shouldNotifyVerbose: vi.fn(() => true),
}));

vi.mock('../../src/services/telegram/telegram-client', () => ({
  enqueueTelegramMessage: mockEnqueue,
}));

import { notifyFromTradeEvent } from '../../src/services/telegram/telegram-notify.service';

describe('notifyFromTradeEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTelegramEnabled.mockReturnValue(true);
    mockShouldNotifyTrades.mockReturnValue(true);
  });

  it('skips partial_fill events', () => {
    notifyFromTradeEvent('partial_fill', {
      symbol: 'BTC',
      executed_qty: 0.01,
      avg_price: 59000,
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips suppress_telegram bookkeeping events', () => {
    notifyFromTradeEvent('position_closed', {
      suppress_telegram: true,
      bookkeeping_close: true,
      symbol: 'BTC',
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips reconciliation_backfill entry events', () => {
    notifyFromTradeEvent('entry_order_filled', {
      reconciliation_backfill: true,
      symbol: 'BTC',
      entry_price: 59000,
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('notifies real entry_order_filled', () => {
    notifyFromTradeEvent('entry_order_filled', {
      symbol: 'BTC',
      side: 'short',
      entry_price: 59150,
      size_qty: 0.033,
      size_usd: 1951.95,
      account_balance: 5000,
    });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const body = mockEnqueue.mock.calls[0][0] as string;
    expect(body).toContain('Mở vị thế');
    expect(body).toContain('BTC');
  });

  it('notifies real position_closed with PnL', () => {
    notifyFromTradeEvent('position_closed', {
      symbol: 'BTC',
      side: 'short',
      entry_price: 58649.5,
      close_price: 58826.9,
      realized_pnl: -6.03,
      close_reason: 'binance_sl',
      account_balance: 4994,
    });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const body = mockEnqueue.mock.calls[0][0] as string;
    expect(body).toContain('Đóng vị thế');
    expect(body).toContain('binance_sl');
  });
});
