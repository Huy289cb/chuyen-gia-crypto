/**
 * Account-level guards before opening new trades (cooldown, consecutive losses).
 */

import { prisma } from '../lib/prisma';
import { getRiskPolicy } from '../config/risk-policy';
import {
  setTestnetAccountCooldown,
  shouldEnterTestnetCooldown,
} from '../repositories/testnet.repository';

export interface AccountTradeGuardResult {
  allowed: boolean;
  reason: string;
}

export async function assertTestnetAccountCanOpenTrade(
  accountId: number
): Promise<AccountTradeGuardResult> {
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    return { allowed: false, reason: 'Testnet account not found' };
  }

  const now = new Date();
  if (account.cooldown_until && account.cooldown_until > now) {
    return {
      allowed: false,
      reason: `Account cooldown active until ${account.cooldown_until.toISOString()}`,
    };
  }

  const policy = getRiskPolicy();
  if ((account.consecutive_losses ?? 0) >= policy.maxConsecutiveLosses) {
    return {
      allowed: false,
      reason: `${account.consecutive_losses} consecutive losses (max ${policy.maxConsecutiveLosses}) — no new entries`,
    };
  }

  return { allowed: true, reason: 'Account trade guard passed' };
}

/** After a losing close, set cooldown_until when threshold reached. */
export async function applyConsecutiveLossCooldownIfNeeded(
  accountId: number
): Promise<void> {
  const check = await shouldEnterTestnetCooldown(accountId);
  if (!check.shouldCooldown || !check.cooldownUntil) {
    return;
  }

  await setTestnetAccountCooldown(accountId, new Date(check.cooldownUntil));
  console.log(`[AccountRiskGuard] ${check.reason}`);
}
