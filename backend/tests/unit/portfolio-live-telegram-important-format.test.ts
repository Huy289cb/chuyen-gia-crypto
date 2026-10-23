import { describe, expect, it } from 'vitest';
import type { LiveDay, LivePortfolioWallet } from '../../src/portfolio/live-service';
import {
  formatImportantDailyReport, formatImportantErrorMessage, formatImportantRecoveryMessage,
  formatImportantRiskMessage, formatImportantTradeMessage,
} from '../../src/portfolio/live-telegram-important-format';

const day: LiveDay = {
  day: '2026-10-19', anchorEquity: '31.47744546', anchorTimeMs: Date.parse('2026-10-18T17:00:00Z'),
  anchorQuality: 'exact_boundary', netCashflow: '0', netPnl: '1.125', worstNetPnl: '-2.25',
  breachUsd: '0', riskLatched: false, latchReason: null,
};
function wallet(overrides: Partial<LivePortfolioWallet> = {}): LivePortfolioWallet {
  return {
    schema: 'authenticated-portfolio-live-v1', policyId: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
    config: { initialCash: '31.47744546', dailyLossLimitUsd: '12', closeBufferUsd: '6.1', softLossThresholdUsd: '-5.9',
      grossCap: '8', leverage: '10', bandThreshold: '.2', slippageBps: '2' },
    accountIdentity: 'PRIVATE-ACCOUNT-ID', handoffSha256: 'PRIVATE-HANDOFF-HASH', startedAtMs: Date.parse('2026-10-16T12:00:00Z'),
    lastObservedAtMs: Date.parse('2026-10-19T14:00:00Z'), bootstrapAccountEquity: '31.47744546',
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
  time: Date.parse('2026-10-19T00:01:00Z'),
};

describe('important live Telegram messages for a non-trader', () => {
  it('says what opened and the currently held direction and price profit without mixing fill and observation times', () => {
    const w = wallet({ positions: { ETHUSDT: { quantity: '.01', averageEntry: '2130' } },
      lastObservation: { marks: { ETHUSDT: '2132' } } });
    const text = formatImportantTradeMessage(w, { ...trade, side: 'BUY', qty: '.01', price: '2130', commission: '.01065', realizedPnl: '0' },
      { positionBefore: '0', positionAfter: '.01', openingFeesBefore: '0' });
    expect(text).toContain('MỞ LỆNH ETH — MUA');
    expect(text).toContain('Giá trị lệnh: 21,30 USDT');
    expect(text).toContain('Phí mở lệnh: 0,01 USDT. Chưa chốt lãi/lỗ.');
    expect(text).toContain('Lãi khi giá tăng, lỗ khi giá giảm.');
    expect(text).toContain('Giao dịch lúc: 2026-10-19 07:01 (giờ Việt Nam).');
    expect(text).toContain('Lệnh ở lần cập nhật 2026-10-19 21:00 (giờ Việt Nam): MUA 0,01 ETH: đang lãi +0,02 USDT.');
    expect(text).toContain('Lãi/lỗ lệnh mở theo giá, chưa tính phí giao dịch và phí giữ lệnh.');
    expect(text.split('\n')).toHaveLength(7);
    expect(text).not.toMatch(/đã chi|vốn bỏ ra|PRIVATE-|ETHUSDT|90071992547409931421|\b(?:BUY|SELL|PnL|NAV|ACK|FILLED)\b/);
  });

  it('allocates actual opening and closing fees to a partial close and keeps exact remaining quantity', () => {
    const text = formatImportantTradeMessage(wallet({ positions: { ETHUSDT: { quantity: '1.5', averageEntry: '2000' } },
      lastObservation: { marks: { ETHUSDT: '2102' } } }), trade,
      { positionBefore: '2', positionAfter: '1.5', openingFeesBefore: '2' });
    expect(text).toContain('ĐÓNG MỘT PHẦN LỆNH ETH');
    expect(text).toContain('Giá trị đã đóng: 1050,00 USDT');
    expect(text).toContain('Lãi/lỗ phần đã đóng: +48,98 USDT (đã trừ phí mở và đóng)');
    expect(text).toContain('Còn giữ 1,5 ETH. Phí giữ lệnh tính ở báo cáo ngày.');
    expect(text).toContain('MUA 1,5 ETH: đang lãi +153,00 USDT.');
    expect(text.split('\n')).toHaveLength(7);
  });

  it('uses Decimal allocation before rounding and reports losses after all trade fees', () => {
    const text = formatImportantTradeMessage(wallet(), { ...trade, qty: '1', commission: '.1', realizedPnl: '.3' },
      { positionBefore: '3', positionAfter: '2', openingFeesBefore: '.3' });
    expect(text).toContain('Lãi/lỗ phần đã đóng: +0,10 USDT');
    const loss = formatImportantTradeMessage(wallet(), { ...trade, qty: '1', commission: '.1', realizedPnl: '.05' },
      { positionBefore: '1', positionAfter: '0', openingFeesBefore: '.1' });
    expect(loss).toContain('ĐÓNG LỆNH ETH');
    expect(loss).toContain('Lãi/lỗ phần đã đóng: -0,15 USDT');
    expect(loss).not.toContain('Còn giữ');
    expect(loss).toContain('không còn giữ ETH.');
  });

  it.each([
    ['.0001', '+<0,01 USDT'], ['-.0001', '-<0,01 USDT'], ['0', '0,00 USDT'], ['.005', '+0,01 USDT'],
  ])('displays a tiny true closing result %s without silently changing its sign or displaying invented zero', (net, expected) => {
    const text = formatImportantTradeMessage(wallet(), { ...trade, qty: '1', commission: '0', realizedPnl: net },
      { positionBefore: '1', positionAfter: '0', openingFeesBefore: '0' });
    expect(text).toContain(`Lãi/lỗ phần đã đóng: ${expected}`);
  });

  it('describes a short opening and a reversal without assigning new opening fees to closed profit', () => {
    const opening = formatImportantTradeMessage(wallet({ positions: { ETHUSDT: { quantity: '-1', averageEntry: '2100' } },
      lastObservation: { marks: { ETHUSDT: '2099' } } }), { ...trade, qty: '1', commission: '.1', realizedPnl: '0' },
      { positionBefore: '0', positionAfter: '-1', openingFeesBefore: '0' });
    expect(opening).toContain('MỞ LỆNH ETH — BÁN');
    expect(opening).toContain('Lãi khi giá giảm, lỗ khi giá tăng.');
    expect(opening).toContain('BÁN 1 ETH: đang lãi +1,00 USDT.');
    const reverse = formatImportantTradeMessage(wallet({ positions: { ETHUSDT: { quantity: '-1', averageEntry: '2100' } },
      lastObservation: { marks: { ETHUSDT: '2110' } } }), { ...trade, qty: '3', commission: '.3', realizedPnl: '.6' },
      { positionBefore: '2', positionAfter: '-1', openingFeesBefore: '.2' });
    expect(reverse).toContain('ĐÓNG LỆNH ETH — MUA VÀ MỞ BÁN');
    expect(reverse).toContain('Lãi/lỗ phần đã đóng: +0,20 USDT');
    expect(reverse).toContain('Mở BÁN 1 ETH.');
    expect(reverse).toContain('BÁN 1 ETH: đang lỗ -10,00 USDT.');
    expect(reverse.split('\n')).toHaveLength(7);
  });

  it('names each held coin and its current price profit in the daily snapshot, separate from net day profit', () => {
    const w = wallet({ positions: {
      ETHUSDT: { quantity: '.009', averageEntry: '2400' },
      BTCUSDT: { quantity: '0', averageEntry: '0' },
      SOLUSDT: { quantity: '-.2', averageEntry: '160' },
    }, lastObservation: { marks: { ETHUSDT: '2390', SOLUSDT: '155' } } });
    const text = formatImportantDailyReport(w, w.currentDay);
    expect(text).toContain('KẾT QUẢ NGÀY 2026-10-19');
    expect(text).toContain('Lãi/lỗ: +1,13 USDT (đã tính phí; gồm lệnh chưa đóng)');
    expect(text).toContain('Tổng vốn hiện tại: 32,60 USDT | Đang có 2 lệnh mở.');
    expect(text).toContain('MUA 0,009 ETH: đang lỗ -0,09 USDT.');
    expect(text).toContain('BÁN 0,2 SOL: đang lãi +1,00 USDT.');
    expect(text).toContain('Lãi/lỗ lệnh mở theo giá, chưa tính phí giao dịch và phí giữ lệnh.');
    expect(text).not.toContain('BTC');
    expect(text).toContain('Từ khi chạy: +1,13 USDT.');
    expect(text).toContain('2026-10-19 21:00 (giờ Việt Nam)');
    expect(text.split('\n')).toHaveLength(8);
    expect(text).not.toMatch(/PRIVATE-|\b(?:PnL|NAV|Funding|ICT|anchorQuality)\b/);
  });

  it('adds warnings only for a genuine incomplete day, missing boundary or pending income', () => {
    const w = wallet({ equityQuality: 'conservative_pending_income', unreconciledWalletDelta: '-.09' });
    expect(formatImportantDailyReport(w, { ...day, anchorQuality: 'initial_partial' })).toContain('chưa đủ 24 giờ');
    const text = formatImportantDailyReport(w, { ...day, anchorQuality: 'missing_boundary', breachUsd: '1.2' });
    expect(text).toContain('Lãi/lỗ ngày là xấp xỉ');
    expect(text).toContain('sàn chưa xác nhận đủ số dư và phí');
    expect(text).toContain('Mức lỗ đã vượt giới hạn ngày 1,20 USDT');
    expect(formatImportantDailyReport(wallet(), day)).not.toMatch(/xấp xỉ|chưa đủ|tạm tính/);
  });

  it('preserves financial stopping consequences without saying positions have already closed', () => {
    const w = wallet({ status: 'risk_latched', currentDay: { ...day, riskLatched: true, netPnl: '-12.7', breachUsd: '.7' } });
    const text = formatImportantRiskMessage(w, 'fixed_daily_loss_close_reserve');
    expect(text).toContain('BOT TẠM DỪNG MỞ LỆNH MỚI');
    expect(text).toContain('Mức lỗ đã đến ngưỡng bảo vệ');
    expect(text).toContain('Lãi/lỗ ngày: -12,70 USDT');
    expect(text).toContain('Giới hạn lỗ: 12,00 USDT/ngày. Đã vượt 0,70 USDT.');
    expect(text).toContain('Chỉ coi lệnh đã đóng khi nhận tin ĐÓNG LỆNH.');
    expect(text.split('\n')).toHaveLength(5);
    expect(text).not.toContain('fixed_daily_loss_close_reserve');
  });

  it('translates connection and manual intervention errors without exposing credentials or pretending stale money is current', () => {
    const manual = formatImportantErrorMessage('Unowned external position detected', wallet());
    expect(manual).toContain('Cần kiểm tra trực tiếp trên sàn');
    expect(manual).toContain('Lãi/lỗ ngày ở lần cập nhật cuối');
    const text = formatImportantErrorMessage('Request failed https://private.example/path?signature=SECRET X-MBX-APIKEY=PRIVATE-KEY', wallet());
    expect(text).toContain('Kết nối với sàn đang gặp lỗi');
    expect(text).toContain('Bot đang tự kiểm tra lại với sàn');
    expect(text.split('\n')).toHaveLength(5);
    expect(text).not.toMatch(/private\.example|SECRET|PRIVATE-|signature|X-MBX/);
    expect(formatImportantErrorMessage('network timeout')).toContain('Chưa có số liệu tài khoản được xác nhận.');
  });

  it('keeps recovery limited to meaningful completion and the unchanged daily limit', () => {
    const text = formatImportantRecoveryMessage(wallet());
    expect(text).toContain('BOT ĐÃ HOẠT ĐỘNG LẠI');
    expect(text).toContain('Đã kiểm tra số dư và các lệnh với sàn.');
    expect(text).toContain('Giới hạn lỗ vẫn là 12,00 USDT/ngày.');
    expect(text.split('\n')).toHaveLength(3);
    expect(formatImportantRecoveryMessage()).not.toContain('Đã kiểm tra số dư');
  });

  it.each([undefined, '', 'NaN', 'Infinity', '0', '-1'])('does not invent zero profit when an open coin price is missing or invalid: %s', mark => {
    const w = wallet({ positions: { ETHUSDT: { quantity: '.01', averageEntry: '2130' } },
      lastObservation: { marks: { ETHUSDT: mark } } });
    const text = formatImportantDailyReport(w, w.currentDay);
    expect(text).toContain('MUA 0,01 ETH: chờ giá hoặc số liệu để tính lãi/lỗ.');
    expect(text).not.toMatch(/đang (?:lãi|lỗ|hòa vốn)/);
  });

  it('does not describe a pre-fill observation as the current post-fill position', () => {
    const w = wallet({ lastObservedAtMs: Number(trade.time) - 1,
      positions: { ETHUSDT: { quantity: '2', averageEntry: '2000' } },
      lastObservation: { marks: { ETHUSDT: '2100' } } });
    const text = formatImportantTradeMessage(w, trade,
      { positionBefore: '2', positionAfter: '1.5', openingFeesBefore: '2' });
    expect(text).toContain('Lãi/lỗ phần đã đóng: +48,98 USDT');
    expect(text).toContain('Hiện tại: chờ cập nhật lệnh ETH sau giao dịch.');
    expect(text).not.toMatch(/đang (?:lãi|lỗ|hòa vốn)|không còn giữ/);
  });

  it('reports actual current inventory rather than reconstructing it from an older trade event', () => {
    const w = wallet({ positions: { ETHUSDT: { quantity: '-.2', averageEntry: '2200' } },
      lastObservation: { marks: { ETHUSDT: '2210' } } });
    const text = formatImportantTradeMessage(w, { ...trade, side: 'BUY', qty: '.01', price: '2130', commission: '.01065', realizedPnl: '0' },
      { positionBefore: '0', positionAfter: '.01', openingFeesBefore: '0' });
    expect(text).toContain('MỞ LỆNH ETH — MUA');
    expect(text).toContain('BÁN 0,2 ETH: đang lỗ -2,00 USDT.');
    expect(text).not.toContain('MUA 0,01 ETH: đang');
  });

  it('keeps current coin PnL visible in important risk, error and recovery messages without mutating the wallet', () => {
    const w = wallet({ positions: { ETHUSDT: { quantity: '.01', averageEntry: '2130' } },
      lastObservation: { marks: { ETHUSDT: '2130' } } });
    const before = JSON.stringify(w);
    for (const text of [formatImportantRiskMessage(w, 'live_monitoring_gap'),
      formatImportantErrorMessage('network timeout', w), formatImportantRecoveryMessage(w)]) {
      expect(text).toContain('MUA 0,01 ETH: đang hòa vốn 0,00 USDT.');
      expect(text).toContain('chưa tính phí giao dịch và phí giữ lệnh');
      expect(text).toContain('Số liệu lúc: 2026-10-19 21:00 (giờ Việt Nam).');
    }
    expect(JSON.stringify(w)).toBe(before);
  });

  it('rejects missing fees, unsupported assets and inconsistent authenticated quantity histories', () => {
    const context = { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '0' };
    for (const patch of [{ commission: undefined }, { commission: '-.1' }, { commissionAsset: 'BNB' },
      { realizedPnl: undefined }, { price: '0' }, { symbol: 'PRIVATE-ACCOUNT' }, { time: NaN }]) {
      expect(() => formatImportantTradeMessage(wallet(), { ...trade, ...patch }, context)).toThrow();
    }
    expect(() => formatImportantTradeMessage(wallet(), trade, { ...context, positionAfter: '.1' })).toThrow();
  });
  it.each(['FILLED', 'UNKNOWN'])('does not claim a coin is flat while another submitted order still needs reconciliation: %s', status => {
    const w = wallet({ intents: [{ clientOrderId: 'pending-new-entry', sourceId: 'new-source', symbol: 'ETHUSDT',
      quantity: '2', reduceOnly: false, createdAtMs: Number(trade.time), submittedOnce: true,
      status, orderId: status === 'FILLED' ? '123' : null, executedQty: status === 'FILLED' ? '2' : '0',
      observedFillQty: '0', lastError: null }] });
    const text = formatImportantTradeMessage(w, trade, { positionBefore: '.5', positionAfter: '0', openingFeesBefore: '.5' });
    expect(text).toContain('Lãi/lỗ phần đã đóng: +48,98 USDT');
    expect(text).toContain('Lệnh ETH đang chờ đối soát với sàn; chưa xác định đủ lãi/lỗ hiện tại.');
    expect(text).not.toContain('không còn giữ');
    expect(formatImportantDailyReport(w, w.currentDay)).toContain('Lệnh ETH đang chờ đối soát');
  });
});
