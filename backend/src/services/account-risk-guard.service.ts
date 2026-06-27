/**
 * Account-level guards before opening new trades (cooldown, consecutive losses).
 */

import { prisma } from '../lib/prisma';
import { getRiskPolicy } from '../config/risk-policy';
import {
  setTestnetAccountCooldown,
  shouldEnterTestnetCooldown,
} from '../repositories/testnet.repository';
import { getBinanceLossStreak } from './binance-trade-history.service';
import { getProtectiveExposureEntryBlock } from './protective-exposure-state';

export interface AccountTradeGuardResult {
  allowed: boolean;
  reason: string;
}

export async function assertTestnetAccountCanOpenTrade(
  accountId: number,
  symbol?: string
): Promise<AccountTradeGuardResult> {
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    return { allowed: false, reason: 'Testnet account not found' };
  }

  const policy = getRiskPolicy();
  const now = new Date();
  const protectiveBlock = getProtectiveExposureEntryBlock();
  if (protectiveBlock) {
    return {
      allowed: false,
      reason: `Protective exposure audit blocked entries: ${protectiveBlock.reason}`,
    };
  }

  if (account.cooldown_until && account.cooldown_until > now) {
    return {
      allowed: false,
      reason: `Account cooldown active until ${account.cooldown_until.toISOString()} (${account.consecutive_losses ?? 0} consecutive losses, max ${policy.maxConsecutiveLosses})`,
    };
  }

  // DB consecutive_losses freezes when SL/TP closes arrive as reconciliation
  // bookkeeping (PnL=0). Derive the real streak from Binance closed rounds.
  if (process.env.BINANCE_ENABLED === 'true' && symbol) {
    try {
      const streak = await getBinanceLossStreak(symbol);
      if (streak.consecutiveLosses >= policy.maxConsecutiveLosses && streak.lastLossTime > 0) {
        const cooldownMs = policy.consecutiveLossCooldownHours * 3_600_000;
        const elapsed = Date.now() - streak.lastLossTime;
        if (elapsed < cooldownMs) {
          const remainingH = (cooldownMs - elapsed) / 3_600_000;
          return {
            allowed: false,
            reason: `Binance loss streak ${streak.consecutiveLosses} ≥ ${policy.maxConsecutiveLosses} — cooldown ${remainingH.toFixed(1)}h remaining`,
          };
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountRiskGuard] Binance loss streak check failed: ${msg}`);
    }
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
