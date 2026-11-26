import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridRebalanceNotice,
  formatHybridStopNotice,
  formatHybridCommandResponse,
  HYBRID_KNOWN_COMMANDS,
} from '../../src/portfolio/hybrid-live-notice';
import { formatToTick } from '../../src/portfolio/hybrid-worker';
import type { HybridLiveState } from '../../src/portfolio/hybrid-worker';
import { loadHybridLiveStateFromDisk } from '../../src/portfolio/hybrid-telegram-worker';

describe('hybrid live telegram notices', () => {
  it('keeps a scientific tick size from rounding the stop price to zero', () => {
    expect(formatToTick(0.003984904, 1e-7)).toBe('0.0039849');
    expect(formatToTick(0.471768, 0.0001)).toBe('0.4717');
  });

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
    expect(formatHybridBreakerNotice(-12.01, false)).toContain('chạm trần 12');
  });

  it('formats interactive Telegram command responses (/status, /report, /lenh, /pnl)', () => {
    const mockState: HybridLiveState = {
      policyId: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
      status: 'active',
      lastObservedAt: new Date().toISOString(),
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
          ratchetTier: 'initial',
        },
        'TIAUSDT': {
          symbol: 'TIAUSDT',
          qty: 46,
          entryPrice: 0.5361,
          markPrice: 0.5481,
          unrlPnl: 0.55,
          slPrice: 0.471768,
          ratchetTier: 'risk_reduction',
        },
      },
      btcGridLevels: [],
    };

    // Test /status
    const statusResp = formatHybridCommandResponse('/status', mockState);
    expect(statusResp).toContain('🟢 WORKER HYBRID LIVE v1.0.4 (OFFICIAL RELEASE)');
    expect(statusResp).toContain('31,45 USDT');
    expect(statusResp).toContain('+0,05 USDT');
    expect(statusResp).toContain('An toàn');

    // Test /report or /lenh
    const reportResp = formatHybridCommandResponse('/report', mockState);
    expect(reportResp).toContain('📊 BÁO CÁO VỊ THẾ HYBRID LIVE v1.0.4');
    expect(reportResp).toContain('1000PEPE');
    expect(reportResp).toContain('TIA');
    expect(reportResp).toContain('SL Giảm rủi ro (-3%): 0,471768');
    expect(reportResp).toContain('Momentum -3.0% (1d)');

    // Test /pnl
    const pnlResp = formatHybridCommandResponse('/pnl', mockState);
    expect(pnlResp).toContain('💰 PNL TỔNG KẾT TÀI KHOẢN');
    expect(pnlResp).toContain('31,45 USDT');

    // Test /help
    const helpResp = formatHybridCommandResponse('/help', mockState);
    expect(helpResp).toContain('🤖 CÁC LỆNH THEO DÕI BOT HYBRID LIVE v1.0.4:');
    expect(helpResp).toContain('/status');
    expect(helpResp).toContain('/report');
    expect(helpResp).toContain('/cashflow');
  });

  it('registers /cashflow, /dongtien, and /tt in HYBRID_KNOWN_COMMANDS and renders momentumRegime', () => {
    expect(HYBRID_KNOWN_COMMANDS.has('cashflow')).toBe(true);
    expect(HYBRID_KNOWN_COMMANDS.has('dongtien')).toBe(true);
    expect(HYBRID_KNOWN_COMMANDS.has('tt')).toBe(true);

    const stateWithRegime: HybridLiveState = {
      policyId: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
      status: 'active',
      lastObservedAt: new Date().toISOString(),
      accountEquity: 94.79,
      availableBalance: 94.79,
      dayStartEquity: 100.0,
      currentDayPnl: -5.21,
      worstDayPnl: -9.75,
      breakerLatched: false,
      positions: {},
      btcGridLevels: [],
      momentumRegime: {
        mode: 'macro_defensive',
        btc1dReturnPct: -2.5,
        btc14dReturnPct: -20.7,
        maxSlots: 1,
        targetAllocPct: 0.25,
      },
      cashFlow: {
        baselineDate: '2026-10-30',
        baselineEquity: 26,
        cumulativeDeposits: 75,
        cumulativeWithdrawals: 0,
        netInjectedCapital: 75,
        adjustedBaselineEquity: 101,
        strategyNetPnl: -6.21,
        strategyRoiPct: -6.15,
      },
    };

    expect(formatHybridCommandResponse('/tt', stateWithRegime)).toContain('Phòng thủ Macro');
    expect(formatHybridCommandResponse('/cashflow', stateWithRegime)).toContain('101,00 USDT');
    expect(formatHybridRebalanceNotice({ closed: [], opened: [], nextRebalanceDate: '2026-11-28' })).toContain('3 NGÀY (v1.0.4)');
    expect(formatHybridBookNotice({ equity: 200, dayPnl: 1.5, positions: [], dailyLossLimitUsd: 24 })).toContain('Trần lỗ 24 USDT/ngày');
  });

  it('loads hybrid live state correctly from disk for standalone Telegram bot', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-test-'));
    const testFile = path.join(tmpDir, 'worker-status.json');
    const sampleState: Partial<HybridLiveState> = {
      policyId: 'TEST_POLICY',
      accountEquity: 100.5,
      positions: {},
    };
    fs.writeFileSync(testFile, JSON.stringify(sampleState));

    const loaded = loadHybridLiveStateFromDisk(testFile);
    expect(loaded).not.toBeNull();
    expect(loaded?.policyId).toBe('TEST_POLICY');
    expect(loaded?.accountEquity).toBe(100.5);

    // Missing file returns null gracefully
    expect(loadHybridLiveStateFromDisk(path.join(tmpDir, 'non-existent.json'))).toBeNull();
  });
});
