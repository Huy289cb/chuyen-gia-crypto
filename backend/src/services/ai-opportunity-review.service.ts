import type { AiOpportunityPolicy } from '../config/ai-opportunity-policy';
import { AI_OPPORTUNITY_PROMPT, opportunityPlanBlock, parseOpportunityChoice,
  type OpportunitySnapshot, type OpportunityFinance, type OpportunityPlan } from '../utils/ai-opportunity';

export interface OpportunityProviderResult {
  content: string; model: string; inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
}
export interface OpportunityReviewDependencies {
  now(): number;
  policy(): AiOpportunityPolicy;
  snapshot(): Promise<OpportunitySnapshot | null>;
  claim(snapshot: OpportunitySnapshot, policy: AiOpportunityPolicy): Promise<number | null>;
  provider(system: string, user: string, policy: AiOpportunityPolicy, signal: AbortSignal): Promise<OpportunityProviderResult>;
  record(type: string, data: Record<string, unknown>): Promise<void>;
  current(): Promise<{ finance: OpportunityFinance; price: number }>;
  claimExecution(reviewId: number): Promise<boolean>;
  execute(plan: OpportunityPlan, snapshot: OpportunitySnapshot, reviewId: number): Promise<{ success: boolean; reason: string }>;
  livePolicyHash(): string | undefined;
}

/** No provider or exchange dependency here: the execution boundary is injected and testable. */
export class AiOpportunityReviewer {
  private running = false;
  constructor(private readonly deps: OpportunityReviewDependencies) {}
  async run(): Promise<{ handled: boolean; reason: string }> {
    const d = this.deps, policy = { ...d.policy() };
    if (this.running || policy.mode === 'off' || !policy.pinned) return { handled: false, reason: 'off_busy_or_policy' };
    this.running = true;
    let reviewId: number | null = null;
    try {
      // JSON boundary prevents later scan mutations from changing the reviewed plan.
      const built = await d.snapshot();
      if (!built?.plans.length) return { handled: false, reason: 'no_eligible_plans' };
      const snapshot: OpportunitySnapshot = JSON.parse(JSON.stringify(built));
      if (snapshot.policyHash !== policy.hash || !this.fresh(snapshot) || snapshot.plans.some(p =>
        opportunityPlanBlock(p, snapshot.finance, policy, d.now()))) return { handled: false, reason: 'invalid_snapshot' };
      reviewId = await d.claim(snapshot, policy);
      if (reviewId === null) return { handled: false, reason: 'duplicate_or_budget' };
      const requestStartedAt = d.now();
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let provider: OpportunityProviderResult;
      try {
        provider = await Promise.race([
          d.provider(AI_OPPORTUNITY_PROMPT, JSON.stringify(snapshot), policy, abort.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { abort.abort(); reject(new Error('provider_timeout')); }, policy.timeoutMs);
          }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
      const choice = parseOpportunityChoice(provider.content, snapshot);
      await d.record('ai_opportunity_review', {
        review_id: reviewId, wave_key: snapshot.waveKey, policy_hash: policy.hash, mode: policy.mode,
        model: provider.model, latency_ms: d.now() - requestStartedAt, input_tokens: provider.inputTokens, output_tokens: provider.outputTokens,
        cost_usd: provider.costUsd, cost_known: provider.costUsd !== null,
        raw_content: provider.content.slice(0, 8192), choice,
        deterministic_plan_id: snapshot.deterministicPlanId, valid: choice !== null,
      });
      if (!choice || choice.decision !== 'take') return { handled: false, reason: choice?.decision ?? 'invalid_response' };
      const plan = snapshot.plans.find(p => p.id === choice.plan_id)!;
      if (policy.mode !== 'live') return { handled: false, reason: 'shadow_take' };
      if (!this.liveAllowed(policy) || !this.fresh(snapshot)) return { handled: false, reason: 'live_disabled_or_expired' };
      const current = await d.current();
      const block = opportunityPlanBlock(plan, current.finance, d.policy(), d.now());
      if (block || !Number.isFinite(current.price) || current.price <= 0 ||
        Math.abs(current.price - plan.entry) / plan.entry > policy.maxPriceDriftFraction ||
        current.price <= Math.min(plan.stopLoss, plan.takeProfit) || current.price >= Math.max(plan.stopLoss, plan.takeProfit)) {
        await d.record('ai_opportunity_blocked', { review_id: reviewId, reason: block ?? 'price_moved' });
        return { handled: false, reason: block ?? 'price_moved' };
      }
      if (!this.liveAllowed(policy) || !this.fresh(snapshot)) return { handled: false, reason: 'late_configuration_change' };
      // Persist BEFORE execution: a crash or uncertain exchange result is never retried automatically.
      if (!await d.claimExecution(reviewId)) return { handled: false, reason: 'already_attempted' };
      if (!this.liveAllowed(policy) || !this.fresh(snapshot)) return { handled: true, reason: 'cancelled_after_claim' };
      const result = await d.execute(plan, snapshot, reviewId);
      await d.record('ai_opportunity_execution', { review_id: reviewId, plan_id: plan.id, ...result });
      return { handled: true, reason: result.reason };
    } catch {
      // Never print arbitrary provider/network errors (may contain credentials).
      try { await d.record('ai_opportunity_error', { review_id: reviewId, reason: 'review_failed_closed' }); } catch { /* unavailable audit also blocks */ }
      // Once a review might have reached execution, do not fall through to another trade this cycle.
      return { handled: policy.mode === 'live' && reviewId !== null, reason: 'review_failed_closed' };
    } finally { this.running = false; }
  }
  private fresh(s: OpportunitySnapshot): boolean {
    const now = this.deps.now();
    return Number.isFinite(s.asOf) && Number.isFinite(s.expiresAt) && s.asOf <= now &&
      now - s.asOf <= this.deps.policy().maxSnapshotAgeMs && now < s.expiresAt;
  }
  private liveAllowed(original: AiOpportunityPolicy): boolean {
    const now = this.deps.policy();
    return now.mode === 'live' && now.pinned && now.hash === original.hash && this.deps.livePolicyHash() === now.hash;
  }
}
