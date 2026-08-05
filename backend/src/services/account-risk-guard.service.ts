/**
 * Account-level guards before opening new trades (cooldown, consecutive losses).
 */

import { prisma } from '../lib/prisma';
import { getRiskPolicy, resolveLossCooldownUntil } from '../config/risk-policy';
import { setTestnetAccountCooldown } from '../repositories/testnet.repository';
import { getBinanceLossStreak } from './binance-trade-history.service';
import { getProtectiveExposureEntryBlock } from './protective-exposure-state';
import {
  applyExpectancyKillCooldownIfNeeded,
  getAccountCircuitStatus,
} from './account-circuit.service';

export interface AccountTradeGuardResult {
  allowed: boolean;
  reason: string;
}

async function resolveLossStreak(
  accountId: number,
  symbol: string
): Promise<{ consecutiveLosses: number; lastLossTime: number }> {
  if (process.env.BINANCE_ENABLED === 'true') {
    try {
      const streak = await getBinanceLossStreak(symbol);
      const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
      if (account && account.consecutive_losses !== streak.consecutiveLosses) {
        await prisma.testnetAccount.update({
          where: { id: accountId },
          data: { consecutive_losses: streak.consecutiveLosses },
        });
      }
      return streak;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[AccountRiskGuard] Binance loss streak check failed: ${msg}`);
    }
  }

  const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  return {
    consecutiveLosses: account?.consecutive_losses ?? 0,
    lastLossTime: 0,
  };
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

  if (account.cooldown_until && account.cooldown_until <= now) {
    await prisma.testnetAccount.update({
      where: { id: accountId },
      data: { cooldown_until: null },
    });
  }

  if (process.env.BINANCE_ENABLED === 'true' && symbol) {
    const streak = await resolveLossStreak(accountId, symbol);
    if (streak.consecutiveLosses >= policy.lossCooldownTier2MinStreak && streak.lastLossTime > 0) {
      const until = resolveLossCooldownUntil(streak.consecutiveLosses, new Date(streak.lastLossTime));
      if (until && Date.now() < until.getTime()) {
        const remainingH = (until.getTime() - Date.now()) / 3_600_000;
        return {
          allowed: false,
          reason: `Binance loss streak ${streak.consecutiveLosses} — cooldown ${remainingH.toFixed(1)}h remaining (until ${until.toISOString()})`,
        };
      }
    }
  }

  const circuit = await getAccountCircuitStatus(accountId);
  if (!circuit.allowed) {
    await applyExpectancyKillCooldownIfNeeded(accountId, circuit);
    return { allowed: false, reason: circuit.reason };
  }

  return { allowed: true, reason: 'Account trade guard passed' };
}

/** After a verified losing close, set cooldown_until when Binance streak threshold reached. */
export async function applyConsecutiveLossCooldownIfNeeded(
  accountId: number,
  symbol = 'BTC'
): Promise<void> {
  const policy = getRiskPolicy();
  const streak = await resolveLossStreak(accountId, symbol);

  if (streak.consecutiveLosses < policy.lossCooldownTier2MinStreak) {
    return;
  }

  const cooldownUntil = resolveLossCooldownUntil(streak.consecutiveLosses, new Date());
  if (!cooldownUntil) {
    return;
  }

  await setTestnetAccountCooldown(accountId, cooldownUntil);
  console.log(
    `[AccountRiskGuard] ${streak.consecutiveLosses} consecutive losses, entering cooldown until ${cooldownUntil.toISOString()}`
  );
}
