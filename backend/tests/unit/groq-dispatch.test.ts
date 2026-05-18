import { describe, it, expect } from 'vitest';
import { GroqDispatchService } from '../../src/services/groq-dispatch.service';
import type { GroqAnalysis } from '../../src/services/groq-client';

describe('GroqDispatchService.normalizeGroqAnalysis', () => {
  const service = new GroqDispatchService();
  const normalize = (raw: GroqAnalysis | null) =>
    (service as unknown as { normalizeGroqAnalysis: (r: GroqAnalysis | null) => GroqAnalysis | null })
      .normalizeGroqAnalysis(raw);

  it('unwraps btc-keyed Kim Nghia payloads', () => {
    const nested = {
      btc: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.85,
        suggested_entry: 100,
        suggested_stop_loss: 95,
        suggested_take_profit: 110,
      },
    } as GroqAnalysis;

    const out = normalize(nested);
    expect(out?.bias).toBe('bullish');
    expect(out?.action).toBe('buy');
    expect(out?.confidence).toBe(0.85);
  });

  it('coerces percent confidence to 0-1 scale', () => {
    const nested = {
      btc: {
        bias: 'neutral',
        action: 'hold',
        confidence: 72,
      },
    } as GroqAnalysis;

    const out = normalize(nested);
    expect(out?.confidence).toBe(0.72);
  });
});
