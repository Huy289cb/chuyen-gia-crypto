import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { opportunityFixture } from '../fixtures/ai-opportunity';

const url = process.env.AI_OPPORTUNITY_TEST_DATABASE_URL;
describe.skipIf(!url)('opportunity PostgreSQL claims (isolated opt-in database)', () => {
  let db: PrismaClient;
  let repo: typeof import('../../src/repositories/ai-opportunity.repository');
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.startsWith('/crypto_ai_review_test_')) throw new Error('Refusing non-test database');
    process.env.DATABASE_URL = url;
    const imported = await import('../../src/lib/prisma'); db = imported.prisma;
    repo = await import('../../src/repositories/ai-opportunity.repository');
    const account = await db.testnetAccount.create({ data: { symbol: 'BTC', method_id: 'kim_nghia',
      starting_balance: 100, current_balance: 100, equity: 100 } });
    await db.testnetPosition.create({ data: { position_id: 'pipeline_v3_kim_nghia', account_id: account.id,
      symbol: 'BTC', side: 'NONE', entry_price: 0, stop_loss: 0, take_profit: 0,
      size_usd: 0, size_qty: 0, risk_usd: 0, risk_percent: 0, expected_rr: 0, status: 'closed' } });
  });
  beforeEach(async () => { await db.testnetTradeEvent.deleteMany({}); });
  afterAll(async () => { if (db) await db.$disconnect(); });
  const fresh = () => {
    const f = opportunityFixture(); f.snapshot.asOf = Date.now(); f.snapshot.expiresAt = Date.now() + 180000;
    return f;
  };
  it('20 concurrent copies of the same wave create exactly one durable claim', async () => {
    const f = fresh();
    const ids = await Promise.all(Array.from({ length: 20 }, () => repo.claimAiOpportunity(f.snapshot, f.policy)));
    expect(ids.filter(id => id !== null)).toHaveLength(1);
    expect(await db.testnetTradeEvent.count()).toBe(1);
  });
  it('daily quota is atomic across different waves and a newly imported caller', async () => {
    const f = fresh(); f.policy.dailyRequests = 3;
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => repo.claimAiOpportunity({ ...f.snapshot, waveKey: `BTC:${i}` }, f.policy)));
    expect(ids.filter(id => id !== null)).toHaveLength(3);
    expect(await repo.claimAiOpportunity({ ...f.snapshot, waveKey: 'BTC:after-restart' }, f.policy)).toBeNull();
  });
  it('execution is one-shot and shadow claims cannot execute', async () => {
    const f = fresh();
    const shadowId = await repo.claimAiOpportunity(f.snapshot, f.policy);
    expect(await repo.claimAiOpportunityExecution(shadowId!)).toBe(false);
    f.policy.mode = 'live'; f.snapshot.waveKey = 'BTC:live';
    const liveId = await repo.claimAiOpportunity(f.snapshot, f.policy);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => repo.claimAiOpportunityExecution(liveId!)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });
  it('expired claim never consumes quota', async () => {
    const f = fresh(); f.snapshot.expiresAt = Date.now() - 1;
    expect(await repo.claimAiOpportunity(f.snapshot, f.policy)).toBeNull();
    expect(await db.testnetTradeEvent.count()).toBe(0);
  });
});
