import { tracedEvent } from '../utils/entry-trace';
import { prisma } from '../lib/prisma';
import { PIPELINE_EVENT_POSITION_ID } from './testnet.repository';
import type { OpportunitySnapshot } from '../utils/ai-opportunity';
import type { AiOpportunityPolicy } from '../config/ai-opportunity-policy';

const LOCK = 86110931;
/** Atomic across API/worker/restarts; no provider call while the transaction is open. */
export async function claimAiOpportunity(s: OpportunitySnapshot, policy: AiOpportunityPolicy): Promise<number | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK}::bigint)`;
    const now = new Date();
    if (now.getTime() >= s.expiresAt || now.getTime() - s.asOf > policy.maxSnapshotAgeMs) return null;
    const day = Math.floor((now.getTime() + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000;
    const existing = await tx.testnetTradeEvent.findFirst({ where: {
      event_type: 'ai_opportunity_claim', event_data: { contains: `"waveKey":${JSON.stringify(s.waveKey)}` },
    } });
    if (existing) return null;
    const count = await tx.testnetTradeEvent.count({ where: {
      event_type: 'ai_opportunity_claim', timestamp: { gte: new Date(day) },
    } });
    if (count >= policy.dailyRequests) return null;
    // Refuse a missing anchor instead of creating a fictional funded account.
    const anchor = await tx.testnetPosition.findUnique({ where: { position_id: PIPELINE_EVENT_POSITION_ID } });
    if (!anchor) throw new Error('pipeline_anchor_missing');
    const event = await tx.testnetTradeEvent.create({ data: { position_id: PIPELINE_EVENT_POSITION_ID,
      event_type: 'ai_opportunity_claim', timestamp: now, event_data: JSON.stringify(tracedEvent({ ...s, mode: policy.mode, model: policy.model })) } });
    return event.id;
  }, { maxWait: 5000, timeout: 5000 });
}
export async function recordAiOpportunity(type: string, data: Record<string, unknown>): Promise<void> {
  await prisma.testnetTradeEvent.create({ data: { position_id: PIPELINE_EVENT_POSITION_ID,
    event_type: type, event_data: JSON.stringify(tracedEvent(data)), timestamp: new Date() } });
}
export async function claimAiOpportunityExecution(reviewId: number): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK}::bigint)`;
    const existing = await tx.testnetTradeEvent.findFirst({ where: {
      event_type: 'ai_opportunity_execution_attempt', event_data: { contains: `"review_id":${reviewId},` },
    } });
    if (existing) return false;
    const review = await tx.testnetTradeEvent.findUnique({ where: { id: reviewId } });
    if (review?.event_type !== 'ai_opportunity_claim') return false;
    const s = JSON.parse(review.event_data ?? '{}') as OpportunitySnapshot & { mode?: string };
    if (s.mode !== 'live' || !Number.isFinite(s.expiresAt) || Date.now() >= s.expiresAt) return false;
    await tx.testnetTradeEvent.create({ data: { position_id: PIPELINE_EVENT_POSITION_ID,
      event_type: 'ai_opportunity_execution_attempt', event_data: JSON.stringify(tracedEvent({ review_id: reviewId, once: true })), timestamp: new Date() } });
    return true;
  }, { maxWait: 5000, timeout: 5000 });
}
