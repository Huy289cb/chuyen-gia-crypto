/**
 * ICT prospective/FVG plans → gate-funnel shadow events. NO orders / NO live ICT enable.
 * Gated by ICT_SHADOW_FUNNEL_ENABLED (default OFF).
 */
import {
  hasSilentPipelineEventKey,
  recordSilentPipelineEvent,
} from '../repositories/testnet.repository';

export interface IctShadowPlan {
  id: string;
  side: 'long' | 'short';
  entry: number;
  stopLoss: number;
  targetPrice?: number | null;
  rr?: number | null;
  confirmedAt?: number;
  playbook?: string;
  source?: string;
}

export interface IctShadowFunnelObservation {
  schema_version: 1;
  role: 'ict_shadow_funnel';
  observation_key: string;
  symbol: string;
  evaluated_at: string;
  plan_id: string;
  side: 'long' | 'short';
  playbook: string;
  entry: number;
  stop_loss: number;
  target_price: number | null;
  rr: number | null;
  /** Overlap vs live kim_nghia playbooks seen on same scan cycle. */
  overlap_kim_nghia: string[];
  conflict_with_kim_nghia: boolean;
  incremental_vs_ls_bo: boolean;
  orders_possible: false;
  source: string;
}

export function isIctShadowFunnelEnabled(): boolean {
  return process.env.ICT_SHADOW_FUNNEL_ENABLED === 'true';
}

export function classifyIctOverlap(input: {
  ictSide: 'long' | 'short';
  kimNghiaPlaybooks: Array<{ playbook: string; side: string | null }>;
}): {
  overlap: string[];
  conflict: boolean;
  incremental: boolean;
} {
  const lsBo = input.kimNghiaPlaybooks.filter(
    (p) => p.playbook === 'liquidity_sweep_reclaim' || p.playbook === 'breakout_volume'
  );
  const overlap = lsBo
    .filter((p) => p.side === input.ictSide)
    .map((p) => p.playbook);
  const conflict = lsBo.some((p) => p.side != null && p.side !== input.ictSide);
  const incremental = overlap.length === 0;
  return { overlap: [...new Set(overlap)], conflict, incremental };
}

/**
 * Persist one ICT shadow candidate. Returns null when disabled, deduped, or invalid.
 */
export async function recordIctShadowFunnel(input: {
  symbol?: string;
  plan: IctShadowPlan;
  kimNghiaPlaybooks?: Array<{ playbook: string; side: string | null }>;
}): Promise<IctShadowFunnelObservation | null> {
  if (!isIctShadowFunnelEnabled()) return null;

  const symbol = (input.symbol ?? 'BTC').toUpperCase();
  const plan = input.plan;
  if (!plan.id || !['long', 'short'].includes(plan.side)) return null;
  if (![plan.entry, plan.stopLoss].every((x) => Number.isFinite(x) && x > 0)) return null;

  const observationKey = `ict_shadow:${symbol}:${plan.id}`;
  if (await hasSilentPipelineEventKey('ict_shadow_funnel', 'observation_key', observationKey)) {
    return null;
  }

  const overlap = classifyIctOverlap({
    ictSide: plan.side,
    kimNghiaPlaybooks: input.kimNghiaPlaybooks ?? [],
  });

  const observation: IctShadowFunnelObservation = {
    schema_version: 1,
    role: 'ict_shadow_funnel',
    observation_key: observationKey,
    symbol,
    evaluated_at: new Date().toISOString(),
    plan_id: plan.id,
    side: plan.side,
    playbook: plan.playbook ?? 'ict_sweep_mss_fvg',
    entry: plan.entry,
    stop_loss: plan.stopLoss,
    target_price: plan.targetPrice ?? null,
    rr: plan.rr ?? null,
    overlap_kim_nghia: overlap.overlap,
    conflict_with_kim_nghia: overlap.conflict,
    incremental_vs_ls_bo: overlap.incremental,
    orders_possible: false,
    source: plan.source ?? 'ict_prospective',
  };

  const eventId = await recordSilentPipelineEvent(
    'ict_shadow_funnel',
    observation as unknown as Record<string, unknown>
  );
  if (eventId === null) throw new Error('ICT shadow funnel persistence failed');
  return observation;
}
