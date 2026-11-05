import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CashFlowManager } from '../../src/portfolio/cashflow-manager';
import type { LiveBroker, LiveIncome } from '../../src/portfolio/live-broker';

const TEST_LEDGER_PATH = path.resolve(__dirname, '../fixtures/test-cashflows.json');

describe('CashFlowManager: External Cash Flow Isolation', () => {
  beforeEach(async () => {
    try {
      await fs.unlink(TEST_LEDGER_PATH);
    } catch {}
  });

  afterEach(async () => {
    try {
      await fs.unlink(TEST_LEDGER_PATH);
    } catch {}
  });

  it('initializes with default baseline values and empty flows', async () => {
    const mgr = new CashFlowManager(TEST_LEDGER_PATH, '2026-10-30', 26.0);
    await mgr.load();

    expect(mgr.getBaselineEquity()).toBe(26.0);
    expect(mgr.getCumulativeDeposits()).toBe(0);
    expect(mgr.getCumulativeWithdrawals()).toBe(0);
    expect(mgr.getNetInjectedCapital()).toBe(0);
    expect(mgr.getAdjustedBaselineEquity()).toBe(26.0);
  });

  it('correctly calculates Strategy PnL and ROI isolating user deposit', async () => {
    const mgr = new CashFlowManager(TEST_LEDGER_PATH, '2026-10-30', 26.0);
    await mgr.load();

    // User deposits 25 USDT
    await mgr.addManualFlow('DEPOSIT', 25.0, 'User top-up');

    expect(mgr.getCumulativeDeposits()).toBe(25.0);
    expect(mgr.getAdjustedBaselineEquity()).toBe(51.0); // 26 + 25

    // If exchange equity is 52.85 USDT:
    // Strategy Net PnL must be 52.85 - 51.00 = +1.85 USDT
    // NOT +26.85 USDT!
    const currentEquity = 52.85;
    const netPnl = mgr.computeStrategyNetPnl(currentEquity);
    expect(netPnl).toBeCloseTo(1.85, 2);

    const roiPct = mgr.computeStrategyRoiPct(currentEquity);
    // 1.85 / 51.0 * 100 = 3.627...%
    expect(roiPct).toBeCloseTo(3.63, 1);

    const summary = mgr.getSummary(currentEquity);
    expect(summary.baselineEquity).toBe(26.0);
    expect(summary.cumulativeDeposits).toBe(25.0);
    expect(summary.adjustedBaselineEquity).toBe(51.0);
    expect(summary.strategyNetPnl).toBe(1.85);
    expect(summary.strategyRoiPct).toBe(3.63);
  });

  it('correctly handles user withdrawal', async () => {
    const mgr = new CashFlowManager(TEST_LEDGER_PATH, '2026-10-30', 26.0);
    await mgr.load();

    await mgr.addManualFlow('DEPOSIT', 25.0, 'Initial deposit');
    await mgr.addManualFlow('WITHDRAWAL', 10.0, 'User takes profit');

    expect(mgr.getCumulativeDeposits()).toBe(25.0);
    expect(mgr.getCumulativeWithdrawals()).toBe(10.0);
    expect(mgr.getNetInjectedCapital()).toBe(15.0);
    expect(mgr.getAdjustedBaselineEquity()).toBe(41.0); // 26 + 15

    // Current equity is 43.0 USDT
    const currentEquity = 43.0;
    expect(mgr.computeStrategyNetPnl(currentEquity)).toBeCloseTo(2.0, 2);
    expect(mgr.computeStrategyRoiPct(currentEquity)).toBeCloseTo((2.0 / 41.0) * 100, 2);
  });

  it('syncs transfers automatically from mock broker without duplication', async () => {
    const mgr = new CashFlowManager(TEST_LEDGER_PATH, '2026-10-30', 26.0);
    await mgr.load();

    const mockBroker: Partial<LiveBroker> = {
      getIncome: async () => [
        {
          symbol: '',
          incomeType: 'TRANSFER',
          income: '25.00000000',
          asset: 'USDT',
          time: 1793288828661,
          tranId: 426197205895,
        } as unknown as LiveIncome,
      ],
    };

    const res1 = await mgr.syncFromBroker(mockBroker as LiveBroker);
    expect(res1.newDeposits.length).toBe(1);
    expect(res1.newDeposits[0].amount).toBe(25.0);
    expect(res1.newDeposits[0].tranId).toBe('426197205895');
    expect(mgr.getCumulativeDeposits()).toBe(25.0);

    // Second sync with identical income returns 0 new deposits (deduplicated)
    const res2 = await mgr.syncFromBroker(mockBroker as LiveBroker);
    expect(res2.newDeposits.length).toBe(0);
    expect(mgr.getCumulativeDeposits()).toBe(25.0);
  });
});
