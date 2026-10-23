import type { GroqAnalysis } from '../services/groq-client';
import { causalPlanBlock, type CausalPlanContract } from './causal-plan-contract';
import { computeExpectedRrFromPrices } from './trade-levels';

export function causalPlanSelectorEnabled(): boolean {
  return process.env.CAUSAL_REVIEW_CONTRACT === 'selector-v1';
}

/** Reviewer chooses this sealed plan; it does not generate or repair prices. */
export function buildCausalPlanSelectorPrompt(plan: CausalPlanContract): string {
  return '\nIMMUTABLE CAUSAL PLAN: ' + JSON.stringify(plan) +
    '\nFINAL RESPONSE CONTRACT — selector-v1: This replaces every earlier output format. ' +
    'Return exactly one JSON object with these four keys only: ' +
    '{"decision":"confirm|hold","plan_hash":"' + plan.hash +
    '","confidence":0.0,"reason":"your nonempty explanation"}. ' +
    'Confirm only this exact plan, or hold to veto it. Confidence must be your own assessment, ' +
    'a number from 0 through 1; do not copy the example value or the deterministic setup score. ' +
    'Copy the plan_hash exactly. Do not return entry, stop, target, invalidation, action, bias, ' +
    'or any extra keys. Code preserves the sealed prices and enforces every existing guard. ' +
    'No markdown or text outside the JSON object.';
}

export interface CausalPlanSelectorResult {
  analysis: GroqAnalysis | null;
  reason?: string;
}

const RESPONSE_KEYS = ['decision', 'plan_hash', 'confidence', 'reason'] as const;

/** Accept only the provider's exact selector contract and the still-valid original plan. */
export function decodeCausalPlanSelector(
  raw: unknown,
  plan: CausalPlanContract,
  symbol: string,
  timeframe: string,
  now: number
): CausalPlanSelectorResult {
  const planFailure = causalPlanBlock(plan, symbol, timeframe, now);
  if (planFailure) return { analysis: null, reason: planFailure };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { analysis: null, reason: 'causal_selector_response_invalid' };
  }
  // Plain objects can originate in another shared-engine VM realm.
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
    return { analysis: null, reason: 'causal_selector_response_invalid' };
  }
  const response = raw as Record<string, unknown>;
  const keys = Object.keys(response);
  if (keys.length !== RESPONSE_KEYS.length ||
      !keys.every(key => RESPONSE_KEYS.includes(key as typeof RESPONSE_KEYS[number]))) {
    return { analysis: null, reason: 'causal_selector_keys_invalid' };
  }
  if (response.decision !== 'confirm' && response.decision !== 'hold') {
    return { analysis: null, reason: 'causal_selector_decision_invalid' };
  }
  if (response.plan_hash !== plan.hash) {
    return { analysis: null, reason: 'causal_selector_plan_hash_mismatch' };
  }
  if (typeof response.confidence !== 'number' || !Number.isFinite(response.confidence) ||
      response.confidence < 0 || response.confidence > 1) {
    return { analysis: null, reason: 'causal_selector_confidence_invalid' };
  }
  if (typeof response.reason !== 'string' || response.reason.trim().length === 0) {
    return { analysis: null, reason: 'causal_selector_reason_invalid' };
  }
  if (response.decision === 'hold') {
    return { analysis: {
      bias: 'neutral', action: 'hold', confidence: response.confidence,
      reason_summary: response.reason,
    } };
  }
  const expectedRr = computeExpectedRrFromPrices(plan.entry, plan.stop, plan.target);
  if (expectedRr === null || !Number.isFinite(expectedRr) || expectedRr <= 0) {
    return { analysis: null, reason: 'causal_selector_rr_invalid' };
  }
  return { analysis: {
    bias: plan.side === 'long' ? 'bullish' : 'bearish',
    action: plan.side === 'long' ? 'buy' : 'sell',
    confidence: response.confidence,
    suggested_entry: plan.entry,
    suggested_stop_loss: plan.stop,
    suggested_take_profit: plan.target,
    invalidation_level: plan.invalidation,
    expected_rr: expectedRr,
    reason_summary: response.reason,
  } };
}
