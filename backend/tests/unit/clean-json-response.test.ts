import { describe, expect, it } from 'vitest';
import {
  escapeControlCharsInJsonStrings,
  insertMissingCommas,
  parseLlmJsonObject,
  quoteUnquotedKeys,
  repairLlmJsonSyntax,
  stripLlmJsonNoise,
} from '../../src/utils/llm-json';
import { cleanJSONResponse } from '../../src/services/groq-client';

describe('escapeControlCharsInJsonStrings', () => {
  it('escapes raw newline/tab inside string values', () => {
    const raw = '{"reason":"line1\nline2\tend","action":"buy"}';
    const fixed = escapeControlCharsInJsonStrings(raw);
    expect(fixed).toBe('{"reason":"line1\\nline2\\tend","action":"buy"}');
    expect(JSON.parse(fixed)).toEqual({
      reason: 'line1\nline2\tend',
      action: 'buy',
    });
  });

  it('leaves already-escaped sequences alone', () => {
    const raw = '{"reason":"ok\\nalready"}';
    expect(escapeControlCharsInJsonStrings(raw)).toBe(raw);
  });

  it('does not touch structural whitespace outside strings', () => {
    const raw = '{\n  "a": 1\n}';
    expect(escapeControlCharsInJsonStrings(raw)).toBe(raw);
  });
});

describe('quoteUnquotedKeys / insertMissingCommas', () => {
  it('quotes bare keys (OpenRouter Unexpected token f)', () => {
    const raw = '{\n  "x": 0.005,\n  fvg_distance: 1.2,\n  "action": "buy"\n}';
    const fixed = quoteUnquotedKeys(raw);
    expect(JSON.parse(fixed)).toEqual({
      x: 0.005,
      fvg_distance: 1.2,
      action: 'buy',
    });
  });

  it('inserts missing commas between properties', () => {
    const raw = '{\n  "x": 0.005\n  "fvg_distance": 1.2\n  "action": "buy"\n}';
    const fixed = insertMissingCommas(raw);
    expect(JSON.parse(fixed)).toEqual({
      x: 0.005,
      fvg_distance: 1.2,
      action: 'buy',
    });
  });

  it('leaves valid pretty JSON alone', () => {
    const raw = '{\n  "a": 1,\n  "b": "ok",\n  "c": true\n}';
    expect(JSON.parse(insertMissingCommas(raw))).toEqual({ a: 1, b: 'ok', c: true });
  });
});

describe('parseLlmJsonObject / cleanJSONResponse', () => {
  it('parses LLM JSON with raw newlines in reason', () => {
    const raw = [
      'Here is the analysis:',
      '{',
      '  "action": "buy",',
      '  "confidence": 0.85,',
      '  "reason": "Breakout with volume',
      'and HTF bias bullish",',
      '  "suggested_entry": 64000,',
      '  "suggested_stop_loss": 63500,',
      '  "suggested_take_profit": 65500,',
      '  "expected_rr": 3',
      '}',
      'Thanks',
    ].join('\n');

    const parsed = cleanJSONResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.action).toBe('buy');
    expect(parsed!.confidence).toBe(0.85);
    expect(parsed!.reason).toContain('Breakout with volume');
    expect(parsed!.reason).toContain('HTF bias bullish');
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"action":"buy","confidence":0.9}\n```';
    expect(parseLlmJsonObject(raw)).toEqual({ action: 'buy', confidence: 0.9 });
  });

  it('repairs unquoted keys + trailing comma together', () => {
    const raw = '{"action":"buy", confidence: 0.8,}';
    expect(repairLlmJsonSyntax(raw)).toContain('"confidence"');
    expect(parseLlmJsonObject(raw)).toEqual({ action: 'buy', confidence: 0.8 });
  });

  it('ignores closing braces inside string values', () => {
    const raw =
      'prefix {"action":"buy","reason":"price hit } then bounced","confidence":0.8} suffix';
    const parsed = cleanJSONResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.reason).toBe('price hit } then bounced');
    expect(parsed!.confidence).toBe(0.8);
  });

  it('handles nested objects and escaped quotes', () => {
    const raw =
      '{"action":"buy","reason":"trader said \\"go { now }\\"","meta":{"x":1},"confidence":0.8}';
    const parsed = cleanJSONResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.reason).toBe('trader said "go { now }"');
    expect((parsed as unknown as { meta: { x: number } }).meta).toEqual({ x: 1 });
  });

  it('rejects truncated JSON instead of inventing missing content', () => {
    expect(cleanJSONResponse('{"action":"buy","reason":"truncated"')).toBeNull();
  });

  it('still rejects garbage without JSON object', () => {
    expect(cleanJSONResponse('no braces here')).toBeNull();
  });

  it('stripLlmJsonNoise removes BOM', () => {
    expect(stripLlmJsonNoise('\uFEFF{"a":1}')).toBe('{"a":1}');
  });
});
