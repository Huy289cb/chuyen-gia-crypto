import { cursorChatConfig } from '../../config/telegram-ai';

export interface CursorJobPayload {
  id: string;
  chatId: string;
  run: () => Promise<void>;
}

const activeByChat = new Map<string, CursorJobPayload>();
const cancelledChats = new Set<string>();

function makeJobId(): string {
  return `cursor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cancelCursorJobForChat(chatId: string): boolean {
  if (!activeByChat.has(chatId)) return false;
  cancelledChats.add(chatId);
  return true;
}

export function isCursorJobCancelled(chatId: string): boolean {
  return cancelledChats.has(chatId);
}

export function clearCursorJobCancellation(chatId: string): void {
  cancelledChats.delete(chatId);
}

export function hasActiveCursorJob(chatId: string): boolean {
  return activeByChat.has(chatId);
}

export function enqueueCursorJob(
  chatId: string,
  run: () => Promise<void>
): { ok: true; jobId: string } | { ok: false; reason: 'busy' } {
  if (activeByChat.has(chatId)) {
    return { ok: false, reason: 'busy' };
  }

  const job: CursorJobPayload = {
    id: makeJobId(),
    chatId,
    run,
  };

  activeByChat.set(chatId, job);
  clearCursorJobCancellation(chatId);

  setImmediate(() => {
    void executeJob(job);
  });

  return { ok: true, jobId: job.id };
}

async function executeJob(job: CursorJobPayload): Promise<void> {
  const started = Date.now();
  let timedOut = false;
  const timeoutMs = cursorChatConfig.jobTimeoutMs;

  const timeout = setTimeout(() => {
    timedOut = true;
    cancelledChats.add(job.chatId);
  }, timeoutMs);

  try {
    await job.run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CursorChat] job.id=${job.id} error=${msg}`);
  } finally {
    clearTimeout(timeout);
    activeByChat.delete(job.chatId);
    const durationMs = Date.now() - started;
    console.log(
      `[CursorChat] job.id=${job.id} durationMs=${durationMs}` +
        (timedOut ? ' timedOut=true' : '')
    );
  }
}
