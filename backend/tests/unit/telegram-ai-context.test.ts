import { describe, it, expect } from 'vitest';
import {
  parseAiCommandArgs,
  redactSensitiveText,
  splitMessageForTelegram,
} from '../../src/services/telegram/ai-context.builder';

describe('telegram-ai context helpers', () => {
  describe('parseAiCommandArgs', () => {
    it('defaults to today_run', () => {
      expect(parseAiCommandArgs('').scope).toBe('today_run');
      expect(parseAiCommandArgs('hom nay').scope).toBe('today_run');
    });

    it('maps known scopes', () => {
      expect(parseAiCommandArgs('loi').scope).toBe('errors');
      expect(parseAiCommandArgs('pipeline').scope).toBe('pipeline');
      expect(parseAiCommandArgs('llm').scope).toBe('llm');
      expect(parseAiCommandArgs('so sanh').scope).toBe('compare');
    });

    it('parses freeform vi question', () => {
      const parsed = parseAiCommandArgs('vi tai sao khong co lenh hom nay?');
      expect(parsed.scope).toBe('freeform');
      expect(parsed.question).toContain('tai sao');
    });

    it('parses cancel action', () => {
      expect(parseAiCommandArgs('cancel').action).toBe('cancel');
      expect(parseAiCommandArgs('huy').action).toBe('cancel');
    });
  });

  describe('redactSensitiveText', () => {
    it('redacts API keys and secrets', () => {
      const input =
        'Bearer sk-abcdefghijklmnopqrstuvwxyz123456 DATABASE_URL=postgres://x BINANCE_API_SECRET=abc cursor_abc123';
      const out = redactSensitiveText(input);
      expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(out).not.toContain('DATABASE_URL');
      expect(out).not.toContain('BINANCE_API_SECRET');
      expect(out).toContain('[REDACTED]');
    });

    it('truncates long strings', () => {
      const long = 'a'.repeat(600);
      expect(redactSensitiveText(long).length).toBeLessThanOrEqual(500);
    });
  });

  describe('splitMessageForTelegram', () => {
    it('returns single chunk when under limit', () => {
      expect(splitMessageForTelegram('hello')).toEqual(['hello']);
    });

    it('splits long text into chunks', () => {
      const text = 'line\n'.repeat(2000);
      const chunks = splitMessageForTelegram(text, 100);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(100);
      }
    });
  });
});
