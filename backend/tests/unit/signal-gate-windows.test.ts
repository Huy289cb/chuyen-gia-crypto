import { describe, expect, it } from 'vitest';
import { getSignalGateCandleLimit, getSignalGateWindows } from '../../src/config/signal-gate-windows';
import { getV3EntryTfPriorityRank } from '../../src/config/v3-schedulers';
import { compareSignalGateForEntry } from '../../src/utils/signal-gate-ranking';
import type { SignalGateOutput } from '../../src/services/signal-gate.service';

describe('signal-gate-windows', () => {
  it('5m uses wider bar windows than 15m', () => {
    const w5 = getSignalGateWindows('5m');
    const w15 = getSignalGateWindows('15m');
    expect(w5.regimeBars).toBeGreaterThan(w15.regimeBars);
    expect(w5.sweepPriorBars).toBeGreaterThan(w15.sweepPriorBars);
    expect(getSignalGateCandleLimit('5m')).toBeGreaterThanOrEqual(100);
  });
});

describe('compareSignalGateForEntry', () => {
  const baseSetup = {
    playbookKey: 'liquidity_sweep_reclaim',
    confidence: 0.85,
    regime: 'trend' as const,
    reason: 'ok',
    detailReason: '',
    evidence: {} as SignalGateOutput['setupResult']['evidence'],
  };

  function row(tf: string, grade: 'A' | 'B' | 'C' | 'D', pass: boolean) {
    return {
      timeframe: tf,
      result: {
        pass,
        shouldCallGroq: pass,
        isDuplicate: false,
        reason: pass ? 'pass' : 'block',
        gateRegime: 'trend' as const,
        setupResult: { ...baseSetup, grade },
      } satisfies SignalGateOutput,
    };
  }

  it('prefers 15m over 5m when both pass with same grade', () => {
    process.env.V3_ENTRY_TF_PRIORITY = '15m,1h,5m';
    const a = row('5m', 'A', true);
    const b = row('15m', 'A', true);
    expect(compareSignalGateForEntry(a, b)).toBeGreaterThan(0);
    expect(getV3EntryTfPriorityRank()['15m']).toBeLessThan(getV3EntryTfPriorityRank()['5m']);
  });
});
