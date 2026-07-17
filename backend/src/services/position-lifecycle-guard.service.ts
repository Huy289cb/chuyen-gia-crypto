/**
 * Central guards against premature Binance market closes and false bookkeeping closes
 * during fill → materialize → protective-order pipeline (deploy/restart races).
 */

import { prisma } from '../lib/prisma';
import {
  BLOCKING_PENDING_ORDER_STATUSES,
} from '../repositories/testnet.repository';

export interface LifecycleDeferResult {
  defer: boolean;
  reason?: string;
}

export interface EmergencyMarketCloseContext {
  symbol: string;
  side: string;
  source: string;
  positionId?: string;
  entryTime?: Date | null;
}

let workerStartedAtMs = Date.now();
const recentEmergencyCloses = new Map<string, number>();

function envMs(name: string, fallback: number): number {
  const raw = parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export function markWorkerStarted(): void {
  workerStartedAtMs = Date.now();
}

export function fillGraceMs(): number {
  return envMs('PROTECTIVE_AUDIT_FILL_GRACE_MS', 180_000);
}

export function newPositionGraceMs(): number {
  return envMs('POSITION_NEW_GRACE_MS', 300_000);
}

export function workerWarmupMs(): number {
  return envMs('PROTECTIVE_AUDIT_STARTUP_DELAY_MS', 90_000);
}

export function emergencyCloseMemoryMs(): number {
  return envMs('POSITION_EMERGENCY_CLOSE_MEMORY_MS', 300_000);
}

export function protectiveAuditStartupDelayMs(): number {
  return workerWarmupMs();
}

export function isWorkerInWarmup(): boolean {
  return Date.now() - workerStartedAtMs < workerWarmupMs();
}

function exposureKey(symbol: string, side: string): string {
  return `${symbol.toUpperCase()}:${side.toLowerCase()}`;
}

export function noteEmergencyMarketClose(symbol: string, side: string, source: string): void {
  recentEmergencyCloses.set(exposureKey(symbol, side), Date.now());
  console.log(
    `[LifecycleGuard] Noted emergency market close ${symbol} ${side} (source=${source})`
  );
}

export function wasRecentEmergencyMarketClose(
  symbol: string,
  side: string,
  windowMs = emergencyCloseMemoryMs()
): boolean {
  const at = recentEmergencyCloses.get(exposureKey(symbol, side));
  return at != null && Date.now() - at < windowMs;
}

function isRecentTimestamp(ts: Date | null | undefined, windowMs: number): boolean {
  if (!ts) return false;
  return Date.now() - ts.getTime() < windowMs;
}

export async function findBlockingPendingForSymbol(symbol: string, side?: string) {
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  return prisma.testnetPendingOrder.findFirst({
    where: {
      symbol: base,
      ...(side ? { side: side.toLowerCase() } : {}),
      status: { in: [...BLOCKING_PENDING_ORDER_STATUSES] },
    },
    orderBy: { created_at: 'desc' },
  });
}

export async function findRecentlyExecutedPending(symbol: string, side?: string) {
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  const since = new Date(Date.now() - fillGraceMs());
  return prisma.testnetPendingOrder.findFirst({
    where: {
      symbol: base,
      ...(side ? { side: side.toLowerCase() } : {}),
      status: { in: ['executed', 'executed_historical'] },
      executed_at: { gte: since },
    },
    orderBy: { executed_at: 'desc' },
  });
}

export async function shouldDeferEmergencyMarketClose(
  input: EmergencyMarketCloseContext
): Promise<LifecycleDeferResult> {
  const side = input.side.toLowerCase() === 'short' ? 'short' : 'long';
  const symbol = input.symbol.toUpperCase().replace(/USDT$/i, '');

  if (isWorkerInWarmup()) {
    return {
      defer: true,
      reason: `worker warmup (${workerWarmupMs()}ms since start)`,
    };
  }

  const blocking = await findBlockingPendingForSymbol(symbol, side);
  if (blocking) {
    return {
      defer: true,
      reason: `blocking pending order ${blocking.order_id} (${blocking.status})`,
    };
  }

  const recentExecuted = await findRecentlyExecutedPending(symbol, side);
  if (recentExecuted) {
    return {
      defer: true,
      reason: `recent executed pending ${recentExecuted.order_id}`,
    };
  }

  if (isRecentTimestamp(input.entryTime, newPositionGraceMs())) {
    return {
      defer: true,
      reason: `position entry within new-position grace (${newPositionGraceMs()}ms)`,
    };
  }

  if (input.positionId) {
    const row = await prisma.testnetPosition.findUnique({
      where: { position_id: input.positionId },
      select: { entry_time: true, binance_sl_order_id: true, binance_tp_order_id: true },
    });
    if (row && isRecentTimestamp(row.entry_time, newPositionGraceMs())) {
      const unhedged = !row.binance_sl_order_id && !row.binance_tp_order_id;
      if (unhedged) {
        return {
          defer: true,
          reason: `new unhedged position ${input.positionId} still within protective grace`,
        };
      }
    }
  }

  return { defer: false };
}

export async function shouldDeferAbsentOnBinanceBookkeepingClose(position: {
  position_id: string;
  symbol: string;
  side: string;
  entry_time?: Date | null;
}): Promise<LifecycleDeferResult> {
  const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
  const symbol = position.symbol.toUpperCase().replace(/USDT$/i, '');

  if (isWorkerInWarmup()) {
    return { defer: true, reason: 'worker warmup' };
  }

  if (isRecentTimestamp(position.entry_time ?? null, newPositionGraceMs())) {
    return {
      defer: true,
      reason: `position ${position.position_id} opened within new-position grace`,
    };
  }

  if (wasRecentEmergencyMarketClose(symbol, side)) {
    return {
      defer: true,
      reason: `recent emergency market close on ${symbol} ${side}`,
    };
  }

  const blocking = await findBlockingPendingForSymbol(symbol, side);
  if (blocking) {
    return {
      defer: true,
      reason: `blocking pending ${blocking.order_id} for ${symbol} ${side}`,
    };
  }

  const recentExecuted = await findRecentlyExecutedPending(symbol, side);
  if (recentExecuted) {
    return {
      defer: true,
      reason: `recent executed pending ${recentExecuted.order_id}`,
    };
  }

  return { defer: false };
}

/** Do not materialize an open row when Binance exposure is already gone (audit race). */
export async function shouldSkipMaterializeWithoutLiveExposure(
  symbol: string,
  side: string
): Promise<LifecycleDeferResult> {
  const localSide = side.toLowerCase() === 'short' ? 'short' : 'long';
  const base = symbol.toUpperCase().replace(/USDT$/i, '');

  if (wasRecentEmergencyMarketClose(base, localSide)) {
    return {
      defer: true,
      reason: `recent emergency close on ${base} ${localSide}`,
    };
  }

  const blocking = await findBlockingPendingForSymbol(base, localSide);
  if (blocking && blocking.status === 'pending') {
    return { defer: false };
  }

  return { defer: false };
}
