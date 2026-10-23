"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelCursorJobForChat = cancelCursorJobForChat;
exports.isCursorJobCancelled = isCursorJobCancelled;
exports.clearCursorJobCancellation = clearCursorJobCancellation;
exports.hasActiveCursorJob = hasActiveCursorJob;
exports.enqueueCursorJob = enqueueCursorJob;
const telegram_ai_1 = require("../../config/telegram-ai");
const activeByChat = new Map();
const cancelledChats = new Set();
function makeJobId() {
    return `cursor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function cancelCursorJobForChat(chatId) {
    if (!activeByChat.has(chatId))
        return false;
    cancelledChats.add(chatId);
    return true;
}
function isCursorJobCancelled(chatId) {
    return cancelledChats.has(chatId);
}
function clearCursorJobCancellation(chatId) {
    cancelledChats.delete(chatId);
}
function hasActiveCursorJob(chatId) {
    return activeByChat.has(chatId);
}
function enqueueCursorJob(chatId, run) {
    if (activeByChat.has(chatId)) {
        return { ok: false, reason: 'busy' };
    }
    const job = {
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
async function executeJob(job) {
    const started = Date.now();
    let timedOut = false;
    const timeoutMs = telegram_ai_1.cursorChatConfig.jobTimeoutMs;
    const timeout = setTimeout(() => {
        timedOut = true;
        cancelledChats.add(job.chatId);
    }, timeoutMs);
    try {
        await job.run();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CursorChat] job.id=${job.id} error=${msg}`);
    }
    finally {
        clearTimeout(timeout);
        activeByChat.delete(job.chatId);
        const durationMs = Date.now() - started;
        console.log(`[CursorChat] job.id=${job.id} durationMs=${durationMs}` +
            (timedOut ? ' timedOut=true' : ''));
    }
}
//# sourceMappingURL=cursor-job-queue.js.map