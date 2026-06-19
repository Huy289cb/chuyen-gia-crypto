import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAgentCreate = vi.hoisted(() => vi.fn());
const mockAgentResume = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockWait = vi.hoisted(() => vi.fn());
const mockAsyncDispose = vi.hoisted(() => vi.fn());
const mockEnqueue = vi.hoisted(() => vi.fn());
const mockEnqueueJob = vi.hoisted(() => vi.fn());
const mockCancelJob = vi.hoisted(() => vi.fn());
const mockFindSession = vi.hoisted(() => vi.fn());
const mockUpsertSession = vi.hoisted(() => vi.fn());
const mockDeleteSession = vi.hoisted(() => vi.fn());
const mockBuildContext = vi.hoisted(() => vi.fn());

vi.mock('@cursor/sdk', () => ({
  Agent: {
    create: mockAgentCreate,
    resume: mockAgentResume,
  },
  CursorAgentError: class CursorAgentError extends Error {
    isRetryable = false;
  },
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    aiCursorSession: {
      findUnique: mockFindSession,
      upsert: mockUpsertSession,
      delete: mockDeleteSession,
    },
  },
}));

vi.mock('../../src/config/telegram-ai', () => ({
  isCursorChatEnabled: vi.fn(() => true),
  canUseCursorChat: vi.fn(() => true),
  cursorChatConfig: {
    model: 'composer-2.5',
    rateLimitPerUserHour: 10,
    sessionTtlMs: 86_400_000,
    jobTimeoutMs: 300_000,
    adminOnly: true,
    enabled: true,
  },
  cursorAgentConfig: {
    apiKey: 'test-key',
    repoUrl: 'https://github.com/org/repo',
    baseBranch: 'develop',
    model: 'composer-2.5',
  },
}));

vi.mock('../../src/services/telegram/cursor-job-queue', () => ({
  enqueueCursorJob: mockEnqueueJob,
  cancelCursorJobForChat: mockCancelJob,
  isCursorJobCancelled: vi.fn(() => false),
}));

vi.mock('../../src/services/telegram/telegram-client', () => ({
  enqueueTelegramMessage: mockEnqueue,
}));

vi.mock('../../src/services/telegram/ai-context.builder', () => ({
  buildAiContext: mockBuildContext,
  contextToJson: vi.fn(() => '{"operatorNotes":[]}'),
  splitMessageForTelegram: (t: string) => [t],
}));

import { handleCursorCommand } from '../../src/services/telegram/cursor-chat.service';
import { isCursorChatEnabled, canUseCursorChat } from '../../src/config/telegram-ai';

describe('handleCursorCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCursorChatEnabled).mockReturnValue(true);
    vi.mocked(canUseCursorChat).mockReturnValue(true);
    mockFindSession.mockResolvedValue(null);
    mockEnqueueJob.mockImplementation((_chatId, run) => {
      void run();
      return { ok: true, jobId: 'cursor-test' };
    });
    mockDeleteSession.mockResolvedValue(undefined);
    mockUpsertSession.mockResolvedValue(undefined);
    mockAsyncDispose.mockResolvedValue(undefined);
    mockAgentCreate.mockResolvedValue({
      agentId: 'bc-new-agent',
      send: mockSend,
      [Symbol.asyncDispose]: mockAsyncDispose,
    });
    mockAgentResume.mockResolvedValue({
      agentId: 'bc-resumed',
      send: mockSend,
      [Symbol.asyncDispose]: mockAsyncDispose,
    });
    mockSend.mockResolvedValue({
      supports: () => false,
      wait: mockWait,
    });
    mockWait.mockResolvedValue({ status: 'finished', result: 'Xin chào bro' });
    mockBuildContext.mockResolvedValue({ meta: {} });
  });

  it('shows help when no args', async () => {
    await handleCursorCommand('chat1', 'user1', '');
    expect(mockEnqueue).toHaveBeenCalledWith(expect.stringContaining('/cursor'), 'chat1');
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('rejects when cursor chat disabled', async () => {
    vi.mocked(isCursorChatEnabled).mockReturnValue(false);
    await handleCursorCommand('chat1', 'user1', 'hello');
    expect(mockEnqueue).toHaveBeenCalledWith(expect.stringContaining('chưa bật'), 'chat1');
  });

  it('rejects non-admin when adminOnly', async () => {
    vi.mocked(canUseCursorChat).mockReturnValue(false);
    await handleCursorCommand('chat1', 'user1', 'hello');
    expect(mockEnqueue).toHaveBeenCalledWith(expect.stringContaining('admin'), 'chat1');
  });

  it('enqueues job and creates new agent for first question', async () => {
    await handleCursorCommand('chat1', 'user1', 'giải thích file reconciliation');
    await vi.waitFor(() => expect(mockAgentCreate).toHaveBeenCalled());

    expect(mockEnqueueJob).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalled();
    expect(mockUpsertSession).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.stringContaining('Xin chào bro'),
      'chat1',
      expect.objectContaining({ plainText: true })
    );
  });

  it('resumes existing session on follow-up', async () => {
    mockFindSession.mockResolvedValue({
      agent_id: 'bc-existing',
      updated_at: new Date(),
    });

    await handleCursorCommand('chat1', 'user1', 'tiếp đi');
    await vi.waitFor(() => expect(mockAgentResume).toHaveBeenCalled());

    expect(mockAgentResume).toHaveBeenCalledWith('bc-existing', expect.any(Object));
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });

  it('/cursor new clears session without question', async () => {
    await handleCursorCommand('chat1', 'user1', 'new');
    expect(mockDeleteSession).toHaveBeenCalled();
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('retries once when cloud run returns error then succeeds', async () => {
    mockWait
      .mockResolvedValueOnce({ status: 'error', id: 'run-err-1' })
      .mockResolvedValueOnce({ status: 'finished', result: 'Trả lời sau retry' });

    await handleCursorCommand('chat1', 'user1', 'test retry');
    await vi.waitFor(() => expect(mockAgentCreate).toHaveBeenCalledTimes(2));

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.stringContaining('Trả lời sau retry'),
      'chat1',
      expect.objectContaining({ plainText: true })
    );
    expect(mockEnqueue).not.toHaveBeenCalledWith(
      expect.stringContaining('Cursor lỗi'),
      'chat1'
    );
  });

  it('surfaces error when cloud run fails twice', async () => {
    mockWait.mockResolvedValue({ status: 'error', id: 'run-err-2' });

    await handleCursorCommand('chat1', 'user1', 'test double fail');
    await vi.waitFor(() => expect(mockAgentCreate).toHaveBeenCalledTimes(2));

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.stringContaining('Cursor lỗi'),
      'chat1'
    );
  });

  it('retries when resume fails with agent_not_found', async () => {
    mockFindSession.mockResolvedValue({
      agent_id: 'bc-dead',
      updated_at: new Date(),
    });
    mockAgentResume.mockRejectedValue(
      Object.assign(new Error('[agent_not_found] Agent not found'), { name: 'CursorAgentError' })
    );

    await handleCursorCommand('chat1', 'user1', 'follow up');
    await vi.waitFor(() => expect(mockAgentCreate).toHaveBeenCalled());

    expect(mockAgentResume).toHaveBeenCalled();
    expect(mockUpsertSession).toHaveBeenCalled();
  });
});
