import { describe, expect, it } from 'vitest';
import {
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridStopNotice,
  formatHybridCommandResponse,
} from '../../src/portfolio/hybrid-live-notice';
import type { HybridLiveState } from '../../src/portfolio/hybrid-worker';

describe('hybrid live telegram notices', () => {
  it('names the open book, the 12% stop, and the 12 USDT breaker', () => {
    const book = formatHybridBookNotice({
      equity: 31.38639119,
      dayPnl: -0.0165,
      positions: [
        { symbol: '1000PEPEUSDT', qty: 5470, unrlPnl: 0.3918, slPrice: 0.003984904 },
        { symbol: 'TIAUSDT', qty: 46, unrlPnl: 0.555, slPrice: 0.471768 },
      ],
    });
    expect(book).toContain('MUA 5470 1000PEPE');
    expect(book).toContain('MUA 46 TIA');
    expect(book).toContain('Dừng lỗ 0,0039849');
    expect(book).toContain('Trần lỗ 12 USDT/ngày');
    expect(formatHybridStopNotice({ symbol: 'TIAUSDT', mark: 0.47, slPrice: 0.471768, sent: true })).toContain('Đã gửi lệnh đóng');
    expect(formatHybridBreakerNotice(-12.01, false)).toContain('chạm trần 12 USDT');
  });

  it('formats interactive Telegram command responses (/status, /report, /lenh, /pnl)', () => {
    const mockState: HybridLiveState = {
      policyId: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
      status: 'active',
      lastObservedAt: '2026-10-24T04:00:00.000Z',
      accountEquity: 31.45,
      availableBalance: 26.50,
      dayStartEquity: 31.40,
      currentDayPnl: 0.05,
      worstDayPnl: -0.02,
      breakerLatched: false,
      positions: {
        '1000PEPEUSDT': {
          symbol: '1000PEPEUSDT',
          qty: 5470,
          entryPrice: 0.0045283,
          markPrice: 0.0046000,
          unrlPnl: 0.39,
          slPrice: 0.0039849,
        },
        'TIAUSDT': {
          symbol: 'TIAUSDT',
          qty: 46,
          entryPrice: 0.5361,
          markPrice: 0.5481,
          unrlPnl: 0.55,
          slPrice: 0.471768,
        },
      },
      btcGridLevels: [],
    };

    // Test /status
    const statusResp = formatHybridCommandResponse('/status', mockState);
    expect(statusResp).toContain('🟢 WORKER PHA 2 HYBRID LIVE');
    expect(statusResp).toContain('31,45 USDT');
    expect(statusResp).toContain('+0,05 USDT');
    expect(statusResp).toContain('An toàn');

    // Test /report or /lenh
    const reportResp = formatHybridCommandResponse('/report', mockState);
    expect(reportResp).toContain('📊 BÁO CÁO VỊ THẾ PHA 2');
    expect(reportResp).toContain('1000PEPE');
    expect(reportResp).toContain('TIA');
    expect(reportResp).toContain('SL 12%: 0,0039849');

    // Test /pnl
    const pnlResp = formatHybridCommandResponse('/pnl', mockState);
    expect(pnlResp).toContain('💰 PNL TỔNG KẾT TÀI KHOẢN');
    expect(pnlResp).toContain('31,45 USDT');

    // Test /help
    const helpResp = formatHybridCommandResponse('/help', mockState);
    expect(helpResp).toContain('🤖 CÁC LỆNH THEO DÕI BOT PHA 2:');
    expect(helpResp).toContain('/status');
    expect(helpResp).toContain('/report');
  });
});
