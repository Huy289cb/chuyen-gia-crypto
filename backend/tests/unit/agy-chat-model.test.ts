import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof import('node:path');
  const tempSettingsPath = nodePath.join(nodeOs.tmpdir(), `agy-telegram-settings-test-${process.pid}.json`);
  process.env.AGY_SETTINGS_STORE_PATH = tempSettingsPath;
  delete process.env.AGY_MODEL;
  return {
    tempSettingsPath,
    spawn: vi.fn(),
    enqueueTelegramMessage: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('../../src/config/telegram-ai', () => ({
  isTelegramAdminUser: () => true,
}));

vi.mock('../../src/services/telegram/telegram-client', () => ({
  enqueueTelegramMessage: mocks.enqueueTelegramMessage,
}));

import {
  DEFAULT_AGY_MODEL,
  agyChatConfig,
  getAgyModel,
  handleAgyCommand,
  handleHybridAgyCommand,
  parseAgyModelsOutput,
  resolveAgyCliModelArgs,
  runAgyCli,
  setChatAgyPreferences,
} from '../../src/services/telegram/agy-chat.service';

const SAMPLE_MODELS_OUTPUT = [
  'Fetching available models...',
  'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
  'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
  'gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)',
  'gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
].join('\n');

function createMockChildProcess(stdoutText = 'ok', exitCode = 0, stderrText = '') {
  const cp = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  cp.killed = false;
  cp.kill = vi.fn();

  queueMicrotask(() => {
    if (stdoutText) cp.stdout.emit('data', Buffer.from(stdoutText));
    if (stderrText) cp.stderr.emit('data', Buffer.from(stderrText));
    cp.emit('close', exitCode, null);
  });

  return cp;
}

describe('AgyChat Gemini 4 Hydrogen default & Telegram model/effort control', () => {
  const originalEnvModel = process.env.AGY_MODEL;
  const chatId = '-1004454909141';

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGY_MODEL;
    setChatAgyPreferences(chatId, undefined);
  });

  afterEach(() => {
    setChatAgyPreferences(chatId, undefined);
    if (originalEnvModel === undefined) {
      delete process.env.AGY_MODEL;
    } else {
      process.env.AGY_MODEL = originalEnvModel;
    }
  });

  afterAll(() => {
    delete process.env.AGY_SETTINGS_STORE_PATH;
    try {
      if (fs.existsSync(mocks.tempSettingsPath)) {
        fs.unlinkSync(mocks.tempSettingsPath);
      }
    } catch {
      /* ignore cleanup error */
    }
  });

  it('defaults to gemini-4-hydrogen-high', () => {
    expect(DEFAULT_AGY_MODEL).toBe('gemini-4-hydrogen-high');
    expect(agyChatConfig.model).toBe('gemini-4-hydrogen-high');
    expect(getAgyModel()).toBe('gemini-4-hydrogen-high');
    expect(resolveAgyCliModelArgs(chatId)).toEqual({
      model: 'gemini-4-hydrogen-high',
      effort: 'high',
      cliArgs: ['--model', 'gemini-4-hydrogen-high'],
      isDefault: true,
      displayModel: 'gemini-4-hydrogen-high',
    });
  });

  it('passes --model gemini-4-hydrogen-high without conflicting --effort when spawning agy CLI', async () => {
    mocks.spawn.mockReturnValueOnce(createMockChildProcess('OK'));

    const res = await runAgyCli('kiểm tra bot', chatId, {
      conversationId: 'conv-123',
    });

    expect(res).toEqual({ ok: true, output: 'OK' });
    const [, args] = mocks.spawn.mock.calls[0] as [string, string[]];
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-hydrogen-high');
    expect(args).not.toContain('--effort');
  });

  it('allows AGY_MODEL environment variable to override default model', async () => {
    process.env.AGY_MODEL = 'gemini-4-hydrogen-xhigh';
    mocks.spawn.mockReturnValueOnce(createMockChildProcess('OK'));

    await runAgyCli('kiểm tra bot', chatId, { isNew: true });

    const [, args] = mocks.spawn.mock.calls[0] as [string, string[]];
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-hydrogen-xhigh');
  });

  it('parses agy models output cleanly', () => {
    const parsed = parseAgyModelsOutput(SAMPLE_MODELS_OUTPUT);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({
      index: 1,
      slug: 'gemini-4-hydrogen-high',
      label: 'Gemini 4 Hydrogen (High)',
    });
    expect(parsed[4].slug).toBe('claude-sonnet-4-6');
  });

  it('lists models via /agy models and switches by index via /agy model <index>', async () => {
    const sendFn = vi.fn(async () => 'msg-1');
    mocks.spawn.mockReturnValueOnce(createMockChildProcess(SAMPLE_MODELS_OUTPUT));

    await handleHybridAgyCommand(chatId, '/agy models', sendFn);
    expect(sendFn).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining('[1] gemini-4-hydrogen-high ⭐ [Đang chọn]')
    );

    await handleHybridAgyCommand(chatId, '/agy model 2', sendFn);
    expect(sendFn).toHaveBeenLastCalledWith(
      chatId,
      expect.stringContaining('• Model: gemini-4-hydrogen-xhigh')
    );

    mocks.spawn.mockReturnValueOnce(createMockChildProcess('OK'));
    await runAgyCli('test prompt', chatId, { conversationId: 'conv-1' });
    const [, args] = mocks.spawn.mock.calls[1] as [string, string[]];
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-hydrogen-xhigh');
    expect(args).not.toContain('--effort');
  });

  it('updates effort via /agy effort and rejects fixed-effort models cleanly', async () => {
    const sendFn = vi.fn(async () => 'msg-1');

    // Mock /effort inspection + models fetch
    mocks.spawn.mockImplementation((_bin: string, args: string[]) => {
      if (args[0] === 'models') {
        return createMockChildProcess(SAMPLE_MODELS_OUTPUT);
      }
      if (args.includes('/effort')) {
        const modelArg = args[args.indexOf('--model') + 1];
        if (modelArg === 'claude-sonnet-4-6') {
          return createMockChildProcess(
            JSON.stringify({
              status: 'SUCCESS',
              command: { name: 'effort', data: { adjustable: false } },
            })
          );
        }
        return createMockChildProcess(
          JSON.stringify({
            status: 'SUCCESS',
            command: {
              name: 'effort',
              data: {
                adjustable: true,
                current: 'high',
                available: ['low', 'medium', 'high', 'xhigh'],
              },
            },
          })
        );
      }
      return createMockChildProcess('OK');
    });

    await handleHybridAgyCommand(chatId, '/agy effort low', sendFn);
    expect(sendFn).toHaveBeenLastCalledWith(
      chatId,
      expect.stringContaining('• Model áp dụng: gemini-4-hydrogen-low')
    );

    // Unsupported tier for Gemini 4 Hydrogen
    await handleHybridAgyCommand(chatId, '/agy effort max', sendFn);
    expect(sendFn).toHaveBeenLastCalledWith(
      chatId,
      expect.stringContaining('không hỗ trợ mức effort "max"')
    );

    // Switch to claude-sonnet-4-6 and try changing effort -> rejected gracefully
    await handleHybridAgyCommand(chatId, '/agy model claude-sonnet-4-6', sendFn);
    await handleHybridAgyCommand(chatId, '/agy effort high', sendFn);
    expect(sendFn).toHaveBeenLastCalledWith(
      chatId,
      expect.stringContaining('effort cố định, không hỗ trợ chỉnh riêng /agy effort')
    );

    // Reset back to default
    await handleHybridAgyCommand(chatId, '/agy model default', sendFn);
    expect(getAgyModel(chatId)).toBe('gemini-4-hydrogen-high');
  });

  it('avoids --model/-suffix conflict when fallback --effort is used without suffixed slug', async () => {
    setChatAgyPreferences(chatId, { model: 'gemini-4-hydrogen-high', effort: 'low' });
    const resolved = resolveAgyCliModelArgs(chatId);
    expect(resolved.cliArgs).toEqual(['--model', 'gemini-4-hydrogen', '--effort', 'low']);

    mocks.spawn.mockReturnValueOnce(createMockChildProcess('OK'));
    await runAgyCli('test fallback', chatId, { conversationId: 'conv-1' });
    const [, args] = mocks.spawn.mock.calls[0] as [string, string[]];
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-hydrogen');
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
  });

  it('supports /agy status and /agy model in both hybrid and legacy handlers', async () => {
    const sendFn = vi.fn(async () => 'msg-1');
    await handleHybridAgyCommand(chatId, '/agy status', sendFn);
    expect(sendFn).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining('• Model: gemini-4-hydrogen-high (mặc định)')
    );
    expect(sendFn).toHaveBeenCalledWith(chatId, expect.stringContaining('• Effort: high'));

    mocks.spawn.mockReturnValueOnce(createMockChildProcess(SAMPLE_MODELS_OUTPUT));
    await handleAgyCommand(chatId, '1289969972', 'model gemini-4-hydrogen-medium');
    expect(mocks.enqueueTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('• Model: gemini-4-hydrogen-medium'),
      chatId,
      { plainText: true }
    );

    await handleAgyCommand(chatId, '1289969972', 'status');
    expect(mocks.enqueueTelegramMessage).toHaveBeenLastCalledWith(
      expect.stringContaining('<code>gemini-4-hydrogen-medium</code>'),
      chatId
    );
  });
});
