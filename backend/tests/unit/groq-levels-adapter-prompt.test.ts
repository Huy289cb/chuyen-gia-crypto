import { describe, expect, it } from 'vitest';
import { buildAdapterPrompts, buildRrOnlyTpAdapterPrompts } from '../../src/services/groq-levels-adapter.service';
import { checkMinSlDistance } from '../../src/utils/trade-levels';

/** Regression: sell @ 77150 / SL 77320 case that failed key2 with 77415 (0.34% < 0.5%). */
describe('buildAdapterPrompts', () => {
  it('includes policy floor SL and self-check for SHORT', () => {
    const entry = 77150;
    const minSlPct = 0.005;
    const { systemPrompt, userPrompt } = buildAdapterPrompts({
      symbol: 'BTC',
      timeframe: '15m',
      action: 'sell',
      entry,
      sl: 77320,
      tp: 76930,
      minSlPct,
      minRr: 1,
    });

    expect(systemPrompt).toContain('77535.75');
    expect(systemPrompt).toContain('suggested_stop_loss >= 77535.75');
    expect(systemPrompt).toContain('0.005');
    expect(userPrompt).toContain('policy_floor_sl=77535.75');
    expect(userPrompt).toContain('min_risk_usd=385.75');

    const floorSl = 77535.75;
    expect(checkMinSlDistance(entry, floorSl, minSlPct).ok).toBe(true);
    expect(checkMinSlDistance(entry, 77415, minSlPct).ok).toBe(false);
  });

  it('includes policy floor SL for LONG', () => {
    const entry = 100000;
    const minSlPct = 0.005;
    const { systemPrompt } = buildAdapterPrompts({
      symbol: 'BTC',
      timeframe: '15m',
      action: 'buy',
      entry,
      sl: 99900,
      tp: 100500,
      minSlPct,
      minRr: 1,
    });

    expect(systemPrompt).toContain('suggested_stop_loss <= 99500');
    expect(checkMinSlDistance(entry, 99500, minSlPct).ok).toBe(true);
  });
});

describe('buildRrOnlyTpAdapterPrompts', () => {
  it('includes policy_min_tp for SHORT', () => {
    const entry = 77150;
    const sl = 77535.75;
    const { systemPrompt, userPrompt } = buildRrOnlyTpAdapterPrompts({
      symbol: 'BTC',
      timeframe: '15m',
      action: 'sell',
      entry,
      sl,
      tp: 77000,
      minSlPct: 0.005,
      minRr: 1,
      currentRr: 0.8,
    });

    expect(systemPrompt).toContain('76764.25');
    expect(userPrompt).toContain('policy_min_tp=76764.25');
  });
});
