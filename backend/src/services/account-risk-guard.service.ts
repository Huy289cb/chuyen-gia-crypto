import {runGuardInvocation} from '../utils/account-guard-invocation';
import {completeAccountGuard} from '../utils/account-guard-completion';
import {evaluateLossStreakCooldown} from '../utils/loss-streak-cooldown-decision';
import { randomUUID } from 'node:crypto';
import { evaluateAccountInitialGuard } from '../utils/account-initial-guard';
import { recordEntryStage } from '../utils/entry-trace';
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
  remainingDailyRiskUsd?: number;
}

function publishGuardMutation(evidence: Record<string, unknown>, appliedAt: string): void {
  void import('../utils/account-wallet-journal')
    .then(module => module.persistAccountWalletObservation(
      { ...evidence, applied_at: appliedAt, applied_clock_source: 'db_update_return' },
      'account_guard_mutation_applied'))
    .catch(() => console.warn('[AccountRiskGuard] Applied mutation journal unavailable'));
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
        const evidence = {
          schema: 'account-guard-mutation-v1', account_id: accountId,
          mutation_attempt_id: randomUUID(), kind: 'exchange_loss_streak_overwrite',
          input: { symbol, previous_consecutive_losses: account.consecutive_losses,
            consecutive_losses: streak.consecutiveLosses, last_loss_time: streak.lastLossTime },
          update: { consecutive_losses: streak.consecutiveLosses },
          write_started_at: new Date().toISOString(),
        };
        await prisma.testnetAccount.update({
          where: { id: accountId },
          data: { consecutive_losses: streak.consecutiveLosses },
        });
        const appliedAt = new Date().toISOString();
        publishGuardMutation(evidence, appliedAt);
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

export async function assertTestnetAccountCanOpenTrade(accountId: number, symbol?: string): Promise<AccountTradeGuardResult> {
  return runGuardInvocation(accountId, symbol, () => evaluateAccountTradeGuard(accountId, symbol), recordEntryStage);
}

async function evaluateAccountTradeGuard(
  accountId: number,
  symbol?: string
): Promise<AccountTradeGuardResult> {
  const readStartedAt = new Date().toISOString();
  const account = await prisma.testnetAccount.findUnique({
    where: { id: accountId },
  });
  const readReturnedAt = new Date().toISOString();

  if (!account) {
    return { allowed: false, reason: 'Testnet account not found' };
  }

  const policy = getRiskPolicy();
  const now = new Date();
  const protectiveBlock = getProtectiveExposureEntryBlock();
  await recordEntryStage('account_guard_inputs', {
    account_schema: 'account-guard-inputs-v2', account_id: accountId,
    read_started_at: readStartedAt, read_returned_at: readReturnedAt, read_clock_source: 'application_db_return',
    observed_at: now.toISOString(), balance: account.current_balance ?? null, equity: account.equity ?? null,
    cooldown_until: account.cooldown_until?.toISOString() ?? null,
    consecutive_losses: account.consecutive_losses ?? null,
    protective_block: protectiveBlock ?? null, policy,
    exchange_loss_streak_status: 'not_evaluated', circuit_status: 'not_evaluated',
  });
  const initialGuard = evaluateAccountInitialGuard({
    protectiveBlock,
    cooldownUntil: account.cooldown_until,
    now,
    consecutiveLosses: account.consecutive_losses,
    maxConsecutiveLosses: policy.maxConsecutiveLosses,
  });
  await recordEntryStage('account_guard_initial_evaluated', {
    account_id: accountId, initial_guard: { schema: 'account-initial-guard-v1',
      read_started_at: readStartedAt, read_returned_at: readReturnedAt, evaluated_at: now.toISOString(),
      input: { protectiveBlock, cooldownUntil: account.cooldown_until?.toISOString() ?? null,
        now: now.toISOString(), consecutiveLosses: account.consecutive_losses,
        maxConsecutiveLosses: policy.maxConsecutiveLosses }, decision: initialGuard } });
  if (!initialGuard.allowed) return { allowed: false, reason: initialGuard.reason };
  if (initialGuard.clearExpiredCooldown) {
    const evidence = {
      schema: 'account-guard-mutation-v1', account_id: accountId,
      mutation_attempt_id: randomUUID(), kind: 'expired_cooldown_clear',
      input: { protective_block: protectiveBlock, cooldown_until: account.cooldown_until?.toISOString() ?? null,
        now: now.toISOString(), consecutive_losses: account.consecutive_losses,
        max_consecutive_losses: policy.maxConsecutiveLosses },
      update: { cooldown_until: null }, write_started_at: new Date().toISOString(),
    };
    await prisma.testnetAccount.update({ where: { id: accountId }, data: { cooldown_until: null } });
    const appliedAt = new Date().toISOString();
    publishGuardMutation(evidence, appliedAt);
  }

  if (process.env.BINANCE_ENABLED === 'true' && symbol) {
    const streak = await resolveLossStreak(accountId, symbol);
    const until = streak.consecutiveLosses >= policy.lossCooldownTier2MinStreak && streak.lastLossTime > 0
      ? resolveLossCooldownUntil(streak.consecutiveLosses, new Date(streak.lastLossTime)) : null;
    const checkedAtMs = until ? Date.now() : null;
    const remainingAtMs = until && checkedAtMs !== null && checkedAtMs < until.getTime() ? Date.now() : null;
    const input = { consecutiveLosses: streak.consecutiveLosses, lastLossTime: streak.lastLossTime,
      minStreak: policy.lossCooldownTier2MinStreak, untilMs: until?.getTime() ?? null, checkedAtMs, remainingAtMs };
    const decision = evaluateLossStreakCooldown(input);
    await recordEntryStage('account_loss_streak_evaluated', { account_id: accountId,
      streak_decision: { schema: 'loss-streak-cooldown-v1', input, decision,
        source: 'exchange_or_local_fallback', history_coverage: 'not_established' } });
    if (!decision.allowed) return { allowed: false, reason: decision.reason! };

  }

  const circuit = await getAccountCircuitStatus(accountId);
  await recordEntryStage('account_circuit_evaluated', {
    account_schema: 'account-circuit-status-v1', account_id: accountId,
    observed_at: new Date().toISOString(), circuit,
  });
  const completionInput = { circuitAllowed: circuit.allowed, circuitReason: circuit.reason,
    startEquity: circuit.startEquity, accountEquity: account.equity,
    dailyLossLimitPercent: policy.dailyLossLimitPercent, dailyLossUsd: circuit.dailyLossUsd };
  const completion = completeAccountGuard(completionInput);
  await recordEntryStage('account_guard_completed', { account_id: accountId,
    completion: { schema: 'account-guard-completion-v1', observed_at: new Date().toISOString(),
      input: completionInput, decision: completion, prior_guard_coverage: 'not_established' } });
  if (!circuit.allowed) {
    await applyExpectancyKillCooldownIfNeeded(accountId, circuit);
    return completion;
  }

  return completion;
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
