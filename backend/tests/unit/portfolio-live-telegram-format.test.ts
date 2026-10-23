import { describe, expect, it } from 'vitest';
import type { LiveDay, LivePortfolioWallet } from '../../src/portfolio/live-service';
import {
  formatLiveDailyReport, formatLiveErrorMessage, formatLiveRiskMessage,
  formatLiveStatusMessage, formatLiveTradeMessage, formatLivePendingMessage, explainLiveTelegramReason, sanitizeLiveTelegramReason,
} from '../../src/portfolio/live-telegram-format';

const day: LiveDay = {
  day: '2026-10-17', anchorEquity: '31.47744546', anchorTimeMs: Date.parse('2026-10-16T17:00:00Z'),
  anchorQuality: 'exact_boundary', netCashflow: '0', netPnl: '1.125', worstNetPnl: '-2.25',
  breachUsd: '0', riskLatched: false, latchReason: null,
};
function wallet(overrides: Partial<LivePortfolioWallet> = {}): LivePortfolioWallet {
  return {
    schema: 'authenticated-portfolio-live-v1', policyId: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
    config: { initialCash: '31.47744546', dailyLossLimitUsd: '15', closeBufferUsd: '6.1', softLossThresholdUsd: '-8.9',
      grossCap: '8', leverage: '10', bandThreshold: '.2', slippageBps: '2' },
    accountIdentity: 'PRIVATE-ACCOUNT-ID', handoffSha256: 'PRIVATE-HANDOFF-HASH', startedAtMs: Date.parse('2026-10-16T12:00:00Z'),
    lastObservedAtMs: Date.parse('2026-10-17T01:00:00Z'), bootstrapAccountEquity: '31.47744546',
    accountEquity: '32.60244546', availableBalance: '20.1', equity: '32.60244546', netCashflow: '0', netPnl: '1.125',
    equityQuality: 'reconciled', unreconciledWalletDelta: '0', positions: {}, actualPositions: [],
    totalFees: '.2', fundingPnl: '-.05', realizedPnl: '1', trades: [], incomes: [], processedTradeIds: [], processedIncomeIds: [],
    intents: [], currentDay: { ...day }, days: [], sourceCursorMs: 0, lastSourceId: null, sourceDisposition: 'waiting',
    status: 'flat', blockedReason: null, continuousRiskGuarantee: false, lastObservation: {}, ...overrides,
  };
}
const trade = {
  symbol: 'ETHUSDT', id: '90071992547409931421', orderId: '90071992547409931420', side: 'SELL',
  qty: '.5', price: '2100', commission: '.525', commissionAsset: 'USDT', realizedPnl: '50',
  time: Date.parse('2026-10-17T00:01:00Z'),
};

describe('authenticated portfolio Telegram text', () => {
  it('explains a partial close with the actual amount and profit after both opening and closing fees', () => {
    const text = formatLiveTradeMessage(wallet(), trade, { positionBefore: '2', positionAfter: '1.5', openingFeesBefore: '2' });
    expect(text).toContain('ĐÓNG MỘT PHẦN LỆNH ETH');
    expect(text).toContain('Đã bán: 0.5 ETH | Giá: 2100 USDT/ETH');
    expect(text).toContain('Giá trị mua/bán: 1050 USDT');
    expect(text).toContain('2026-10-17 07:01:00 (giờ Việt Nam)');
    expect(text).toContain('Lãi/lỗ phần đã đóng: +48.975 USDT (đã trừ phí mở và đóng)');
    expect(text).toContain('Phí tính cho phần đóng: 1.025 USDT');
    expect(text).toContain('Còn giữ: 1.5 ETH');
    expect(text).toContain('Phí/tiền nhận khi giữ lệnh được tính trong báo cáo toàn tài khoản, chưa chia riêng');
    expect(text.split('\n')).toHaveLength(7);
    expect(text).not.toMatch(/\b(?:PnL|NAV|SELL|BUY|Funding|ETHUSDT)\b/);
    expect(text).not.toContain('PRIVATE-');
  });

  it('labels opens, increases and complete closes from actual before/after quantity', () => {
    const buy = { ...trade, side: 'BUY', qty: '1', realizedPnl: '0', commission: '.0000000001' };
    const open = formatLiveTradeMessage(wallet(), buy, { positionBefore: '0', positionAfter: '1', openingFeesBefore: '0' });
    expect(open).toContain('MỞ LỆNH ETH — MUA');
    expect(open).toContain('Phí mua/bán vừa trả: 0.0000000001 USDT');
    expect(open).toContain('Phần vừa mở chưa có lãi/lỗ đã chốt');
    expect(open).toContain('lời khi giá tăng, lỗ khi giá giảm');
    expect(open.split('\n')).toHaveLength(5);
    expect(open).not.toContain('Lãi/lỗ phần đã đóng');
    expect(formatLiveTradeMessage(wallet(), buy, { positionBefore: '1', positionAfter: '2', openingFeesBefore: '.1' })).toContain('MUA THÊM ETH');
    const close = formatLiveTradeMessage(wallet(), trade, { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '.2' });
    expect(close).toContain('ĐÓNG LỆNH ETH');
    expect(close).toContain('Phí tính cho phần đóng: 0.725 USDT');
    expect(close).toContain('Lãi/lỗ phần đã đóng: +49.275 USDT');
    expect(close).not.toContain('Còn giữ:');
  });

  it('uses Money40 rather than binary floats for fill and prior-fee accounting', () => {
    const text = formatLiveTradeMessage(wallet(), { ...trade, qty: '1', commission: '.1', realizedPnl: '.3' },
      { positionBefore: '3', positionAfter: '2', openingFeesBefore: '.3' });
    expect(text).toContain('Phí tính cho phần đóng: 0.2 USDT');
    expect(text).toContain('Lãi/lỗ phần đã đóng: +0.1 USDT');
    expect(text).not.toContain('999999');
  });

  it('selects actual trades and wallet funding by ICT day, without double-counting commission income', () => {
    const w = wallet({
      trades: [
        { ...trade, time: Date.parse('2026-10-16T16:59:59.999Z'), realizedPnl: '1000', commission: '50' },
        { ...trade, time: Date.parse('2026-10-16T17:00:00Z'), realizedPnl: '.1', commission: '.01' },
        { ...trade, time: Date.parse('2026-10-17T16:59:59.999Z'), realizedPnl: '.2', commission: '.02' },
        { ...trade, time: Date.parse('2026-10-17T17:00:00Z'), realizedPnl: '1000', commission: '50' },
      ],
      incomes: [
        { incomeType: 'FUNDING_FEE', income: '-.04', time: Date.parse('2026-10-17T00:00:00Z') },
        { incomeType: 'COMMISSION', income: '-.03', time: Date.parse('2026-10-17T00:00:00Z') },
        { incomeType: 'FUNDING_FEE', income: '99', time: Date.parse('2026-10-17T17:00:00Z') },
      ],
    });
    const text = formatLiveDailyReport(w, w.currentDay, true);
    expect(text).toContain('2026-10-17 (giờ Việt Nam)');
    expect(text).toContain('Số lần mua/bán được sàn xác nhận: 2');
    expect(text).toContain('đóng lệnh +0.3 USDT, phí mua/bán 0.03 USDT, phí/tiền nhận khi giữ lệnh -0.04 USDT');
    expect(text).toContain('Lãi/lỗ đã ghi vào số dư: +0.23 USDT');
    expect(text).toContain('Lãi/lỗ của ngày: +1.125 USDT');
    expect(text).toContain('theo số nạp/rút đã biết lúc ghi nhận');
    expect(text).toContain('Số nạp/rút được sàn báo muộn có thể chưa được sửa');
    expect(text).toContain('Tổng giá trị vốn bot hiện tại: 32.60244546 USDT (gồm lãi/lỗ lệnh chưa đóng)');
    expect(text).toContain('chưa có số liệu chính xác đúng lúc kết thúc ngày');
    expect(text).toContain('Số liệu hiện tại lúc: 2026-10-17 08:00:00 (giờ Việt Nam); không phải số dư cuối ngày đã qua');
    expect(text).not.toMatch(/\b(?:PnL|NAV|Funding|ICT|anchorQuality)\b/);
    expect(text).not.toContain('99 USDT');
  });

  it('warns that archived NAV may omit late transfer classification, without calling deposits profit', () => {
    const w = wallet({ incomes: [
      { incomeType: 'TRANSFER', income: '10', time: Date.parse('2026-10-17T00:00:00Z') },
      { incomeType: 'INTERNAL_TRANSFER', income: '-2', time: Date.parse('2026-10-17T01:00:00Z') },
      { incomeType: 'TRANSFER', income: '100', time: Date.parse('2026-10-17T17:00:00Z') },
    ] });
    const text = formatLiveDailyReport(w, w.currentDay, true);
    expect(text).toContain('Có 2 lần nạp/rút ngày này, tổng +8 USDT');
    expect(text).toContain('kết quả đã lưu có thể chưa cập nhật hết');
    expect(text).toContain('cần kiểm tra bổ sung trước khi chốt lợi nhuận ngày');
    expect(text).not.toContain('loại nạp/rút).');
    expect(text).not.toContain('+108 USDT');
  });

  it('qualifies current-day transfer exclusion as amounts already classified', () => {
    const w = wallet(), text = formatLiveDailyReport(w, w.currentDay, false);
    expect(text).toContain('Lãi/lỗ của ngày: +1.125 USDT');
    expect(text).toContain('đã loại số nạp/rút được xác nhận');
    expect(text).not.toContain('Số nạp/rút được sàn báo muộn có thể chưa được sửa');
  });

  it('discloses initial partial days, missing anchors and delayed authenticated income', () => {
    const w = wallet({ equityQuality: 'conservative_pending_income', unreconciledWalletDelta: '-.09' });
    const partial = formatLiveDailyReport(w, { ...day, anchorQuality: 'initial_partial' }, true);
    expect(partial).toContain('Ngày đầu chỉ tính từ');
    expect(partial).toContain('chưa đủ 24 giờ');
    expect(partial).toContain('Sàn chưa xác nhận đủ tiền nhận/phí');
    expect(partial).toContain('-0.09 USDT');
    const missing = formatLiveDailyReport(w, { ...day, anchorQuality: 'missing_boundary', riskLatched: true, breachUsd: '1.2' }, true);
    expect(missing).toContain('lãi/lỗ ngày chỉ là xấp xỉ');
    expect(missing).toContain('Mức lỗ đã vượt giới hạn: 1.2 USDT');
    expect(missing).toContain('Đã dừng mở lệnh mới');
  });

  it('does not turn successful notification integration into a fabricated trade or PnL', () => {
    const text = formatLiveStatusMessage(wallet({ netPnl: '0', trades: [] }));
    expect(text).toContain('TELEGRAM ĐÃ KẾT NỐI');
    expect(text).toContain('Đang có 0 lệnh mở');
    expect(text).toContain('Đây là tin kết nối, chưa phát sinh giao dịch vì tin này.');
    expect(text).not.toContain('PRIVATE-ACCOUNT-ID');
    expect(text).not.toContain('PRIVATE-HANDOFF-HASH');
  });

  it('redacts signed URLs and credentials in risk/error text without hiding useful failure context', () => {
    const reason = 'Request failed https://api.telegram.org/bot123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/sendMessage?signature=signedsecret ' +
      'X-MBX-APIKEY=MY-KEY secret=MY-SECRET {"token":"MY-TOKEN"} authorization=Bearer BEARER-SECRET signature=SIGNED-SECRET';
    const sanitized = sanitizeLiveTelegramReason(reason);
    for (const secret of ['api.telegram.org', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', 'signedsecret', 'MY-KEY', 'MY-SECRET', 'MY-TOKEN', 'BEARER-SECRET', 'SIGNED-SECRET']) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized).toContain('Request failed');
    for (const text of [formatLiveErrorMessage(reason), formatLiveErrorMessage(reason, wallet()), formatLiveRiskMessage(wallet(), reason)]) {
      expect(text.length).toBeLessThan(3500);
      expect(text).not.toContain('MY-TOKEN');
      expect(text).not.toContain('PRIVATE-');
    }
    expect(formatLiveRiskMessage(wallet(), 'loss budget exceeded')).toContain('Chỉ coi lệnh đã đóng khi nhận thông báo ĐÓNG LỆNH được sàn xác nhận');
  });

  it('rejects unsupported or missing actual fees instead of inventing financial data', () => {
    expect(() => formatLiveTradeMessage(wallet(), { ...trade, commissionAsset: 'BNB' },
      { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '0' })).toThrow();
    expect(() => formatLiveTradeMessage(wallet(), { ...trade, commission: undefined },
      { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '0' })).toThrow();
    expect(() => formatLiveTradeMessage(wallet(), { ...trade, realizedPnl: undefined },
      { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '0' })).toThrow();
    expect(() => formatLiveTradeMessage(wallet(), { ...trade, price: '0' },
      { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '0' })).toThrow();
  });

  it('reports a loss even if the raw closing gain is positive but the real fees exceed it', () => {
    const text = formatLiveTradeMessage(wallet(), { ...trade, qty: '1', commission: '.1', realizedPnl: '.05' },
      { positionBefore: '1', positionAfter: '0', openingFeesBefore: '.1' });
    expect(text).toContain('Lãi/lỗ phần đã đóng: -0.15 USDT');
    expect(text).toContain('Phí tính cho phần đóng: 0.2 USDT');
  });

  it('allocates the current fee only to the quantity closed when one fill reverses direction', () => {
    const text = formatLiveTradeMessage(wallet(), { ...trade, qty: '3', commission: '.3', realizedPnl: '.6' },
      { positionBefore: '2', positionAfter: '-1', openingFeesBefore: '.2' });
    expect(text).toContain('ĐÓNG LỆNH ETH VÀ MỞ CHIỀU NGƯỢC');
    expect(text).toContain('Lãi/lỗ phần đã đóng: +0.2 USDT');
    expect(text).toContain('Đã đóng 2 ETH; mở lệnh bán 1 ETH, phí mở mới 0.1 USDT');
  });

  it('describes a sell opening in plain language without promising a profit', () => {
    const text = formatLiveTradeMessage(wallet(), { ...trade, qty: '1', realizedPnl: '0' },
      { positionBefore: '0', positionAfter: '-1', openingFeesBefore: '0' });
    expect(text).toContain('MỞ LỆNH ETH — BÁN');
    expect(text).toContain('lời khi giá giảm, lỗ khi giá tăng');
    expect(text).toContain('Phần vừa mở chưa có lãi/lỗ đã chốt');
  });

  it('explains pending confirmation without claiming an ACK is a completed trade', () => {
    const text = formatLivePendingMessage(wallet({ unreconciledWalletDelta: '-.2' }), 'ETHUSDT');
    expect(text).toContain('ĐANG KIỂM TRA KẾT QUẢ MUA/BÁN ETH');
    expect(text).toContain('Số tiền còn chờ kiểm tra: -0.2 USDT');
    expect(text).toContain('Tạm chặn lệnh mới');
    expect(text).toContain('30 giây');
    expect(text).not.toMatch(/\b(?:ACK|FILLED|intent|PnL|NAV|ETHUSDT)\b/);
  });

  it.each([
    ['live_monitoring_gap', 'gián đoạn theo dõi giá quá lâu'],
    ['fixed_daily_loss_close_reserve', 'Mức lỗ đã đến ngưỡng bảo vệ'],
    ['Stale venue quote ETHUSDT', 'Giá từ sàn cập nhật chậm'],
    ['Source preparation failed', 'Chưa lấy được dữ liệu để chọn lệnh'],
    ['unresolved_or_partial_order', 'Chưa xác nhận đủ kết quả mua/bán'],
    ['Authenticated history unavailable; conservative risk only', 'Số dư, phí hoặc lịch sử giao dịch'],
    ['Account position mode mismatch', 'không khớp dữ liệu của bot'],
  ])('explains the actionable meaning of %s without exposing its technical identifier', (reason, explanation) => {
    const text = formatLiveErrorMessage(reason, wallet());
    expect(text).toContain(explanation);
    expect(text).not.toContain(reason);
    expect(text).not.toMatch(/\b(?:ACK|FILLED|intent|PnL|NAV|reconciliation_required)\b/);
  });

  it('uses a safe plain fallback for an unfamiliar exception and retains an existing plain Vietnamese reason', () => {
    expect(explainLiveTelegramReason('Unexpected internal failure code PRIVATE-123')).toBe('Hệ thống chưa hoàn tất một bước kiểm tra; cần đối chiếu lại số liệu với sàn.');
    expect(explainLiveTelegramReason('Sàn đang bảo trì')).toBe('Sàn đang bảo trì');
  });
});
