import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  formatSideLabel,
  formatTradeNotify,
  mapTradeEventType,
} from '../../src/services/telegram/message-formatters';

describe('telegram message-formatters', () => {
  it('escapeHtml escapes special chars', () => {
    expect(escapeHtml('<a&b>')).toBe('&lt;a&amp;b&gt;');
  });

  it('mapTradeEventType returns title for known events', () => {
    expect(mapTradeEventType('position_closed')).toContain('Đóng');
    expect(mapTradeEventType('unknown_xyz')).toBeNull();
  });

  it('formatSideLabel maps buy/sell to Long/Short', () => {
    expect(formatSideLabel('long')).toBe('Long');
    expect(formatSideLabel('SELL')).toBe('Short');
  });

  it('formatTradeNotify includes open trade fields', () => {
    const msg = formatTradeNotify({
      title: '🟢 Mở vị thế (fill)',
      symbol: 'BTC',
      side: 'long',
      entry: 95000,
      stopLoss: 94000,
      takeProfit: 97000,
      sizeQty: 0.04,
      sizeUsd: 3800,
      accountBalance: 4975,
    });
    expect(msg).toContain('Long');
    expect(msg).toContain('Giá mở:');
    expect(msg).toContain('SL:');
    expect(msg).toContain('TP:');
    expect(msg).toContain('Volume:');
    expect(msg).toContain('Tài khoản:');
  });

  it('formatTradeNotify includes close trade PnL and balance', () => {
    const msg = formatTradeNotify({
      title: '🔴 Đóng vị thế',
      symbol: 'BTC',
      side: 'short',
      closePrice: 96000,
      pnl: -12.5,
      accountBalance: 4962.5,
      reason: 'stop_loss',
    });
    expect(msg).toContain('PnL:');
    expect(msg).toContain('Giá đóng:');
    expect(msg).toContain('Tài khoản:');
    expect(msg).toContain('stop_loss');
  });
});
