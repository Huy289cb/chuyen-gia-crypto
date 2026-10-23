"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelAiJobForChat = cancelAiJobForChat;
exports.isAiJobCancelled = isAiJobCancelled;
exports.clearAiJobCancellation = clearAiJobCancellation;
exports.hasActiveAiJob = hasActiveAiJob;
exports.enqueueAiJob = enqueueAiJob;
const activeByChat = new Map();
const cancelledChats = new Set();
const JOB_TIMEOUT_MS = 60_000;
function makeJobId() {
    return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function cancelAiJobForChat(chatId) {
    if (!activeByChat.has(chatId))
        return false;
    cancelledChats.add(chatId);
    return true;
}
function isAiJobCancelled(chatId) {
    return cancelledChats.has(chatId);
}
function clearAiJobCancellation(chatId) {
    cancelledChats.delete(chatId);
}
function hasActiveAiJob(chatId) {
    return activeByChat.has(chatId);
}
function enqueueAiJob(chatId, userId, scope, run) {
    if (activeByChat.has(chatId)) {
        return { ok: false, reason: 'busy' };
    }
    const job = {
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
async function executeJob(job) {
    const started = Date.now();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        cancelledChats.add(job.chatId);
    }, JOB_TIMEOUT_MS);
    try {
        await job.run();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TelegramAI] job.id=${job.id} scope=${job.scope} error=${msg}`);
    }
    finally {
        clearTimeout(timeout);
        activeByChat.delete(job.chatId);
        const durationMs = Date.now() - started;
        console.log(`[TelegramAI] job.id=${job.id} scope=${job.scope} durationMs=${durationMs}` +
            (timedOut ? ' timedOut=true' : ''));
    }
}
//# sourceMappingURL=ai-job-queue.js.map