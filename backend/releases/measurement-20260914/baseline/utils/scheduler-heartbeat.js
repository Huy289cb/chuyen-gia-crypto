"use strict";
/**
 * Scheduler last-run tracking: in-memory (same process) + DB (worker → API dashboard).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSchedulerRun = recordSchedulerRun;
exports.getSchedulerLastRun = getSchedulerLastRun;
exports.getPersistedSchedulerLastRun = getPersistedSchedulerLastRun;
exports.getAllSchedulerHeartbeats = getAllSchedulerHeartbeats;
exports.inferWorkerActivityStatus = inferWorkerActivityStatus;
const prisma_1 = require("../lib/prisma");
const lastRuns = new Map();
const lastPersistedAt = new Map();
/** Min interval between DB upserts (in-memory lastRuns still update every cycle). */
const MIN_HEARTBEAT_PERSIST_MS = parseInt(process.env.SCHEDULER_HEARTBEAT_PERSIST_INTERVAL_MS || '120000', 10);
function recordSchedulerRun(name) {
    const now = new Date();
    lastRuns.set(name, now);
    const lastPersist = lastPersistedAt.get(name) ?? 0;
    if (Date.now() - lastPersist < MIN_HEARTBEAT_PERSIST_MS) {
        return;
    }
    lastPersistedAt.set(name, Date.now());
    void persistSchedulerHeartbeat(name, now).catch((err) => {
        console.error(`[SchedulerHeartbeat] Failed to persist ${name}:`, err);
    });
}
async function persistSchedulerHeartbeat(name, lastRun) {
    await prisma_1.prisma.schedulerHeartbeat.upsert({
        where: { name },
        create: { name, last_run: lastRun },
        update: { last_run: lastRun },
    });
}
function getSchedulerLastRun(name) {
    return lastRuns.get(name) ?? null;
}
/** Read persisted heartbeat (API process reads worker-written rows). */
async function getPersistedSchedulerLastRun(name) {
    try {
        const row = await prisma_1.prisma.schedulerHeartbeat.findUnique({ where: { name } });
        return row?.last_run ?? null;
    }
    catch {
        return null;
    }
}
function getAllSchedulerHeartbeats() {
    return {
        MarketScan: lastRuns.get('MarketScan')?.toISOString() ?? null,
        LLMDispatch: lastRuns.get('LLMDispatch')?.toISOString() ?? null,
        PositionMonitor: lastRuns.get('PositionMonitor')?.toISOString() ?? null,
        PendingOrderLifecycle: lastRuns.get('PendingOrderLifecycle')?.toISOString() ?? null,
    };
}
/** Dashboard worker liveness — scheduler heartbeats, not OHLCV bar timestamps. */
async function inferWorkerActivityStatus() {
    const staleAfterMs = parseInt(process.env.WORKER_STALE_AFTER_MS || String(10 * 60_000), 10);
    const [persistedMarket, persistedLlm, persistedPos] = await Promise.all([
        getPersistedSchedulerLastRun('MarketScan'),
        getPersistedSchedulerLastRun('LLMDispatch'),
        getPersistedSchedulerLastRun('PositionMonitor'),
    ]);
    const inMemory = [
        getSchedulerLastRun('MarketScan'),
        getSchedulerLastRun('LLMDispatch'),
        getSchedulerLastRun('PositionMonitor'),
    ];
    const times = [...[persistedMarket, persistedLlm, persistedPos], ...inMemory]
        .filter((d) => d instanceof Date)
        .map((d) => d.getTime());
    if (times.length === 0)
        return 'idle';
    const last = Math.max(...times);
    return Date.now() - last < staleAfterMs ? 'healthy' : 'stale';
}
//# sourceMappingURL=scheduler-heartbeat.js.map