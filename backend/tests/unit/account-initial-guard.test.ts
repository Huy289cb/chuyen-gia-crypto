import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateAccountInitialGuard } from '../../src/utils/account-initial-guard';

// Compare against the deployed branch, including its database clear intent.
const deployed = readFileSync(resolve('dist/services/account-risk-guard.service.js'), 'utf8');
const start = deployed.indexOf(' if (protectiveBlock) {');
const end = deployed.indexOf("    if (process.env.BINANCE_ENABLED === 'true' && symbol)", start);
if (start < 0 || end < start) throw new Error('Deployed initial guard branch unavailable');
const legacy = new (Object.getPrototypeOf(async function () {}).constructor)(
  'protectiveBlock', 'account', 'policy', 'now', 'prisma_1',
  'const accountId = account.id;\n' + deployed.slice(start, end) + '\nreturn {allowed:true,reason:null};'
);

describe('shared initial guard versus deployed branch', () => {
  const now = new Date('2026-10-03T00:00:00Z');
  for (const protectiveBlock of [null, { reason: 'missing protective order' }]) {
    for (const cooldownUntil of [null, new Date(now.getTime()-1), new Date(now),
      new Date(now.getTime()+1), new Date('invalid')]) {
      for (const consecutiveLosses of [null, 0, 2]) {
        it(`matches block=${!!protectiveBlock} cooldown=${String(cooldownUntil)} losses=${consecutiveLosses}`, async () => {
          const writes: unknown[] = [];
          const input = { protectiveBlock, cooldownUntil, now, consecutiveLosses, maxConsecutiveLosses: 2 };
          const result = await legacy(protectiveBlock, { id: 1, cooldown_until: cooldownUntil,
            consecutive_losses: consecutiveLosses }, { maxConsecutiveLosses: 2 }, now,
            { prisma: { testnetAccount: { update: async (write: unknown) => { writes.push(write); } } } });
          const shared = evaluateAccountInitialGuard(input);
          expect({ allowed: shared.allowed, reason: shared.reason }).toEqual(result);
          expect(writes).toEqual(shared.clearExpiredCooldown
            ? [{ where: { id: 1 }, data: { cooldown_until: null } }] : []);
        });
      }
    }
  }
});
