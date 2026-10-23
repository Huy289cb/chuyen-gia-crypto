import { createHash } from 'node:crypto';
import { getRiskPolicy } from './risk-policy';
import { getOpenRouterDispatchModel } from './openrouter-models';

export const AI_OPPORTUNITY_VERSION = 'btc-plans-v1';
export type OpportunityMode = 'off' | 'shadow' | 'live';
export function getAiOpportunityPolicy() {
  const raw = process.env.AI_OPPORTUNITY_MODE;
  const mode: OpportunityMode = raw === 'shadow' || raw === 'live' ? raw : 'off';
  const integer = (key: string, fallback: number, max: number) => {
    const n = Number(process.env[key]);
    return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
  };
  const decimal = (key: string, fallback: number, min: number, max: number) => {
    const raw = process.env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const risk = getRiskPolicy();
  const limits = {
    version: AI_OPPORTUNITY_VERSION,
    minRr: decimal('AI_OPPORTUNITY_MIN_RR', 3, 1, 5),
    minSlFraction: Math.max(.008, risk.minSlDistancePercent),
    maxRiskPercent: risk.maxEffectiveRiskPerTradePercent,
    maxRiskUsd: risk.maxEffectiveRiskPerTradeUsd,
    dailyPercent: risk.dailyLossLimitPercent,
    targetPercent: risk.riskPerTradePercent,
    feePercent: Math.max(.1, risk.maxFeePercent),
    slippagePercent: Math.max(.1, risk.maxSlippagePercent),
    maxExposure: risk.maxTotalExposureUsd,
    model: process.env.AI_OPPORTUNITY_MODEL?.trim() || getOpenRouterDispatchModel(),
    timeoutMs: integer('AI_OPPORTUNITY_TIMEOUT_MS', 10000, 15000),
    dailyRequests: integer('AI_OPPORTUNITY_DAILY_REQUESTS', 12, 24),
    ttlMs: 180000, maxSnapshotAgeMs: 120000, maxPriceDriftFraction: .0025,
  };
  // This lane uses the owner's fixed runtime risk contract, never alternate defaults.
  const pinned = [limits.minSlFraction, limits.targetPercent, limits.maxExposure, limits.feePercent, limits.slippagePercent]
    .every(v => Number.isFinite(v) && v > 0) && limits.maxRiskPercent === 3 && limits.maxRiskUsd === null &&
    limits.dailyPercent === 10 && risk.consecutiveLossCooldownHours === 1 &&
    risk.lossCooldownTier2Hours === 1 && risk.lossCooldownTier3Hours === 1 &&
    !risk.lossCooldownTier3UntilUtcDay && risk.circuitExpectancyCooldownHours === 1 &&
    ['POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES', 'POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES',
      'PENDING_ORDER_REENTRY_COOLDOWN_MINUTES'].every(k => process.env[k] === '60');
  const hash = createHash('sha256').update(JSON.stringify({ ...limits, pinned, risk })).digest('hex');
  return { ...limits, mode, pinned, hash };
}
export type AiOpportunityPolicy = ReturnType<typeof getAiOpportunityPolicy>;
