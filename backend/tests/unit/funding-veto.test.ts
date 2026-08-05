import { describe, expect, it } from 'vitest';
import { evaluateFundingVeto } from '../../src/config/funding-veto';
import { compareSignalGateForEntry } from '../../src/utils/signal-gate-ranking';
import type { SignalGateOutput } from '../../src/services/signal-gate.service';

describe('evaluateFundingVeto', () => {
  it('passes when disabled', () => {
    expect(
      evaluateFundingVeto({ side: 'long', fundingRate: 0.001, enabled: false }).pass
    ).toBe(true);
  });

  it('fail-open when rate null', () => {
    const r = evaluateFundingVeto({ side: 'long', fundingRate: null, enabled: true });
    expect(r.pass).toBe(true);
  });

  it('blocks long when funding strongly positive', () => {
    const r = evaluateFundingVeto({
      side: 'long',
      fundingRate: 0.0005,
      enabled: true,
      absThreshold: 0.0003,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('FUNDING_VETO');
  });

  it('allows short when funding strongly positive', () => {
    expect(
      evaluateFundingVeto({
        side: 'short',
        fundingRate: 0.0005,
        enabled: true,
        absThreshold: 0.0003,
      }).pass
    ).toBe(true);
  });

  it('blocks short when funding strongly negative', () => {
    expect(
      evaluateFundingVeto({
        side: 'short',
        fundingRate: -0.0005,
        enabled: true,
        absThreshold: 0.0003,
      }).pass
    ).toBe(false);
  });

  it('passes when |rate| below threshold', () => {
    expect(
      evaluateFundingVeto({
        side: 'long',
        fundingRate: 0.0001,
        enabled: true,
        absThreshold: 0.0003,
      }).pass
    ).toBe(true);
  });
});

function gate(
  playbookKey: string,
  grade: 'A' | 'B',
  confidence: number,
  timeframe: string
): { timeframe: string; result: SignalGateOutput } {
  return {
    timeframe,
    result: {
      pass: true,
      setupResult: {
        playbookKey,
        grade,
        confidence,
        regime: 'trend',
        reason: 'test',
        evidence: {} as never,
        detailReason: '',
      },
      reason: 'pass',
    } as SignalGateOutput,
  };
}

describe('signal-gate ranking playbook tie-break', () => {
  it('prefers liquidity_sweep over breakout when grade+conf equal', () => {
    const ls = gate('liquidity_sweep_reclaim', 'A', 0.85, '5m');
    const bo = gate('breakout_volume', 'A', 0.85, '15m');
    // LS on 5m should rank before BO on 15m when conf equal (playbook before TF)
    expect(compareSignalGateForEntry(ls, bo)).toBeLessThan(0);
    expect(compareSignalGateForEntry(bo, ls)).toBeGreaterThan(0);
  });
});
