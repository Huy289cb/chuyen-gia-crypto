import { describe, expect, it } from 'vitest';
import { classifyIctOverlap } from '../../src/services/ict-shadow-funnel.service';

describe('classifyIctOverlap', () => {
  it('marks incremental when no LS/BO same-side overlap', () => {
    const r = classifyIctOverlap({
      ictSide: 'long',
      kimNghiaPlaybooks: [{ playbook: 'breakout_volume', side: 'short' }],
    });
    expect(r.incremental).toBe(true);
    expect(r.conflict).toBe(true);
    expect(r.overlap).toEqual([]);
  });

  it('detects LS/BO same-side overlap', () => {
    const r = classifyIctOverlap({
      ictSide: 'short',
      kimNghiaPlaybooks: [
        { playbook: 'liquidity_sweep_reclaim', side: 'short' },
        { playbook: 'breakout_volume', side: 'long' },
      ],
    });
    expect(r.overlap).toEqual(['liquidity_sweep_reclaim']);
    expect(r.incremental).toBe(false);
    expect(r.conflict).toBe(true);
  });
});
