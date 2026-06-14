import { describe, it, expect } from 'vitest';
import {
  parseAiCommandArgs,
  redactSensitiveText,
  splitMessageForTelegram,
} from '../../src/services/telegram/ai-context.builder';
import {
  getConversationalGreeting,
  getSystemPrompt,
  getUserPrompt,
  isConversationalScope,
} from '../../src/services/telegram/ai-prompts';

describe('telegram-ai context helpers', () => {
  describe('parseAiCommandArgs', () => {
    it('defaults to conversational freeform when empty', () => {
      expect(parseAiCommandArgs('')).toEqual({ action: 'analyze', scope: 'freeform' });
    });

    it('maps report keywords exactly', () => {
      expect(parseAiCommandArgs('hom nay').scope).toBe('today_run');
      expect(parseAiCommandArgs('homnay').scope).toBe('today_run');
      expect(parseAiCommandArgs('bao cao').scope).toBe('today_run');
      expect(parseAiCommandArgs('baocao').scope).toBe('today_run');
      expect(parseAiCommandArgs('loi').scope).toBe('errors');
      expect(parseAiCommandArgs('pipeline').scope).toBe('pipeline');
      expect(parseAiCommandArgs('llm').scope).toBe('llm');
      expect(parseAiCommandArgs('so sanh').scope).toBe('compare');
    });

    it('treats free text as conversational question', () => {
      const parsed = parseAiCommandArgs('tai sao khong co lenh hom nay?');
      expect(parsed.scope).toBe('freeform');
      expect(parsed.question).toBe('tai sao khong co lenh hom nay?');
    });

    it('does not treat partial report keywords as report mode', () => {
      const parsed = parseAiCommandArgs('hom nay sao khong co lenh');
      expect(parsed.scope).toBe('freeform');
      expect(parsed.question).toContain('hom nay');
    });

    it('still supports legacy vi prefix', () => {
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

describe('telegram-ai prompts', () => {
  it('identifies conversational scope', () => {
    expect(isConversationalScope('freeform')).toBe(true);
    expect(isConversationalScope('today_run')).toBe(false);
  });

  it('uses bro personality for freeform system prompt', () => {
    const prompt = getSystemPrompt('freeform');
    expect(prompt).toContain('bro');
    expect(prompt).toContain('KHÔNG dump');
  });

  it('puts question before context in conversational user prompt', () => {
    const prompt = getUserPrompt('freeform', '{"x":1}', 'tai sao khong vao lenh?');
    const qIdx = prompt.indexOf('Câu hỏi:');
    const ctxIdx = prompt.indexOf('Dữ liệu hệ thống');
    expect(qIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeGreaterThan(qIdx);
    expect(prompt).toContain('Trả lời như bro');
  });

  it('provides conversational greeting', () => {
    expect(getConversationalGreeting()).toContain('/ai bao cao');
  });
});
