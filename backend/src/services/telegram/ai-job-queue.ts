export interface AiJobPayload {
  id: string;
  chatId: string;
  userId?: string;
  scope: string;
  run: () => Promise<void>;
}

const activeByChat = new Map<string, AiJobPayload>();
const cancelledChats = new Set<string>();

const JOB_TIMEOUT_MS = 60_000;

function makeJobId(): string {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cancelAiJobForChat(chatId: string): boolean {
  if (!activeByChat.has(chatId)) return false;
  cancelledChats.add(chatId);
  return true;
}

export function isAiJobCancelled(chatId: string): boolean {
  return cancelledChats.has(chatId);
}

export function clearAiJobCancellation(chatId: string): void {
  cancelledChats.delete(chatId);
}

export function hasActiveAiJob(chatId: string): boolean {
  return activeByChat.has(chatId);
}

export function enqueueAiJob(
  chatId: string,
  userId: string | undefined,
  scope: string,
  run: () => Promise<void>
): { ok: true; jobId: string } | { ok: false; reason: 'busy' } {
  if (activeByChat.has(chatId)) {
    return { ok: false, reason: 'busy' };
  }

  const job: AiJobPayload = {
    id: makeJobId(),
    chatId,
    userId,
    scope,
    run,
  };

  activeByChat.set(chatId, job);
  clearAiJobCancellation(chatId);

  setImmediate(() => {
    void executeJob(job);
  });

  return { ok: true, jobId: job.id };
}

async function executeJob(job: AiJobPayload): Promise<void> {
  const started = Date.now();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    cancelledChats.add(job.chatId);
  }, JOB_TIMEOUT_MS);

  try {
    await job.run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TelegramAI] job.id=${job.id} scope=${job.scope} error=${msg}`);
  } finally {
    clearTimeout(timeout);
    activeByChat.delete(job.chatId);
    const durationMs = Date.now() - started;
    console.log(
      `[TelegramAI] job.id=${job.id} scope=${job.scope} durationMs=${durationMs}` +
        (timedOut ? ' timedOut=true' : '')
    );
  }
}
