import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  formatSideLabel,
  formatTradeNotify,
  mapTradeEventType,
  formatShowSummary,
  formatPipelineSummary,
  formatStatusSummary,
  formatSchedulerCompact,
  formatOpenPositionForLenh,
  statusEmoji,
  schedulerIcon,
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

  it('formatShowSummary is compact', () => {
    const msg = formatShowSummary({
      equity: 5000,
      totalBalance: 4800,
      dailyPnL: 25.5,
      openCount: 1,
      pendingCount: 0,
      riskLocked: false,
      lockReason: null,
      notifyMuted: false,
    });
    expect(msg).toContain('Equity');
    expect(msg).toContain('PnL hôm nay');
    expect(msg).toContain('1 mở');
    expect(msg).not.toContain('Pipeline');
  });

  it('formatShowSummary includes Binance trade stats', () => {
    const msg = formatShowSummary({
      equity: 5000,
      totalBalance: 4800,
      dailyPnL: 25.5,
      openCount: 1,
      pendingCount: 0,
      closedCount: 3,
      wins: 2,
      losses: 1,
      tradeStatsSource: 'binance',
      riskLocked: false,
      lockReason: null,
      notifyMuted: false,
    });
    expect(msg).toContain('Giao dịch hôm nay: 3 (W2/L1)');
  });

  it('formatOpenPositionForLenh shows side volume TP SL PnL', () => {
    const msg = formatOpenPositionForLenh({
      symbol: 'BTC',
      side: 'short',
      sizeUsd: 748,
      entry: 66000,
      mark: 65500,
      stopLoss: 68000,
      takeProfit: 64000,
      unrealizedPnl: 5.6,
    });
    expect(msg).toContain('SHORT');
    expect(msg).toContain('$748.00');
    expect(msg).toContain('TP');
    expect(msg).toContain('SL');
    expect(msg).toContain('PnL');
  });

  it('formatPipelineSummary shows schedulers and last decision', () => {
    const msg = formatPipelineSummary({
      schedulers: [{ name: 'MarketScan', status: 'running', lastRun: '2 min ago' }],
      warmupOk: true,
      llmTotal: 10,
      llmTrades: 2,
      lastDecision: { decision: 'no_trade', reason: 'low grade', ago: '5 min ago' },
    });
    expect(msg).toContain('MarketScan');
    expect(msg).toContain('no_trade');
    expect(msg).not.toContain('cron=');
  });

  it('formatStatusSummary uses green/red indicators', () => {
    const msg = formatStatusSummary({
      workerStatus: 'healthy',
      databaseStatus: 'healthy',
      safetyValidation: 'passed',
      schedulers: [{ name: 'LLMDispatch', status: 'stale', lastRun: '1h ago' }],
      warmupOk: true,
      riskLocked: false,
      lockReason: null,
      binanceEnabled: true,
      recentErrors: [],
    });
    expect(msg).toContain('🟢');
    expect(msg).toContain('🔴');
    expect(msg).toContain('1 stale');
  });

  it('schedulerIcon and statusEmoji', () => {
    expect(statusEmoji(true)).toBe('🟢');
    expect(schedulerIcon('stale')).toBe('🔴');
    expect(formatSchedulerCompact({ name: 'Pos', status: 'running', lastRun: 'now' })).toContain('Pos');
  });
});
