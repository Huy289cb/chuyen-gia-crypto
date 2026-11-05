import { describe, it, expect } from 'vitest';
import { formatHybridCommandResponse } from '../../src/portfolio/hybrid-live-notice';
import type { HybridLiveState } from '../../src/portfolio/hybrid-worker';

describe('Cash Flow Isolation: Telegram & State Integration', () => {
  const mockState: HybridLiveState = {
    policyId: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
    status: 'active',
    lastObservedAt: '2026-11-05T03:00:00Z',
    accountEquity: 52.85,
    availableBalance: 48.68,
    dayStartEquity: 52.53,
    currentDayPnl: 0.32,
    worstDayPnl: 0,
    breakerLatched: false,
    positions: {
      BEAMXUSDT: {
        symbol: 'BEAMXUSDT',
        qty: 2925,
        entryPrice: 0.004314,
        markPrice: 0.00455,
        unrlPnl: 0.69,
        slPrice: 0.004348,
        ratchetTier: 'breakeven',
      },
    },
    btcGridLevels: [],
    cashFlow: {
      baselineDate: '2026-10-30',
      baselineEquity: 26.0,
      cumulativeDeposits: 25.0,
      cumulativeWithdrawals: 0,
      netInjectedCapital: 25.0,
      adjustedBaselineEquity: 51.0,
      strategyNetPnl: 1.85,
      strategyRoiPct: 3.63,
    },
  };

  it('formats /pnl command showing clean separation between user deposit and trading profit', () => {
    const reply = formatHybridCommandResponse('/pnl', mockState);

    expect(reply).toContain('PNL TỔNG KẾT TÀI KHOẢN (PHÂN LẬP MINH BẠCH)');
    expect(reply).toMatch(/Vốn sàn thực tế \(Equity\): 52[,.]85 USDT/);
    expect(reply).toMatch(/Vốn nạp cơ sở \(Gốc \+ Nạp\): 51[,.]00 USDT/);
    expect(reply).toMatch(/26[,.]00 USDT gốc \+ 25[,.]00 USDT nạp/);
    expect(reply).toMatch(/Lãi ròng do bot tự đánh \(từ 2026-10-30\): \+1[,.]85 USDT \(\+3\.63%\)/);
    expect(reply).toMatch(/Lãi\/lỗ hôm nay: \+0[,.]32 USDT/);
  });

  it('formats /cashflow command with detailed capital breakdown', () => {
    const reply = formatHybridCommandResponse('/cashflow', mockState);

    expect(reply).toContain('QUẢN LÝ DÒNG TIỀN NGOẠI VI (PHÂN LẬP VỐN)');
    expect(reply).toContain('Mốc tính chuẩn: 2026-10-30');
    expect(reply).toMatch(/Vốn xuất phát mốc chuẩn: 26[,.]00 USDT/);
    expect(reply).toMatch(/Tổng tiền nạp thêm: \+25[,.]00 USDT/);
    expect(reply).toMatch(/Vốn cơ sở điều chỉnh: 51[,.]00 USDT/);
    expect(reply).toMatch(/Lãi\/lỗ ròng chiến lược: \+1[,.]85 USDT \(\+3\.63%\)/);
    expect(reply).toContain('tuyệt đối không tính vào lãi giao dịch');
  });

  it('includes /cashflow in /help command', () => {
    const reply = formatHybridCommandResponse('/help', mockState);
    expect(reply).toContain('/cashflow');
    expect(reply).toContain('Quản lý dòng tiền nạp/rút');
  });
});
