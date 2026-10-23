import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getOpenRouterDispatchModel, getOpenRouterShadowModel } from '../config/openrouter-models';
import { withProviderPurpose } from '../utils/provider-purpose-context';
import { analyzeViaOpenRouter } from './openrouter-client';
import { parseLlmJsonObject } from '../utils/llm-json';

/**
 * LOG-ONLY OpenRouter "risk veto" shadow lane for the portfolio worker.
 *
 * The model sees the already computed daily target weights and returns a
 * per-symbol keep/reduce/veto verdict. Nothing here feeds back into execution:
 * the plan is snapshotted (deep copy), the call is fire-and-forget with a hard
 * timeout, and every error is absorbed into an `invalid` NDJSON observation.
 * Observations are consumed only by the offline evaluator
 * (src/portfolio/risk-veto-shadow-eval.ts).
 */

export const RISK_VETO_SHADOW_SCHEMA = 'openrouter-risk-veto-shadow-v1';
export const RISK_VETO_ACTIONS = ['keep', 'reduce', 'veto'] as const;
export const RISK_VETO_REASON_CODES = [
  'news_event', 'liquidation_cascade', 'extreme_funding', 'exchange_risk', 'none',
] as const;
export type RiskVetoAction = typeof RISK_VETO_ACTIONS[number];
export type RiskVetoReasonCode = typeof RISK_VETO_REASON_CODES[number];

export interface RiskVetoPlanLeg {
  symbol: string;
  side: 'long' | 'short' | 'flat';
  /** Signed planned target weight (fraction of equity). */
  weight: number;
  /** Last closed daily price known when the plan was computed. */
  price: number | null;
  return1d: number | null;
  return7d: number | null;
  return30d: number | null;
  /** Annualized realized volatility (30 daily log returns). */
  realizedVol30: number | null;
  /** Source-provided annualized 90d volatility, when available. */
  annVol90: number | null;
}

export interface RiskVetoPlanSnapshot {
  policyId: string | null;
  sourceId: string;
  knownAtMs: number;
  executeAtMs: number;
  legs: RiskVetoPlanLeg[];
}

export interface RiskVetoVerdict {
  symbol: string;
  action: RiskVetoAction;
  sizeMultiplier: number;
  confidence: number;
  reasonCode: RiskVetoReasonCode;
  shortReason: string;
}

export interface RiskVetoObservation {
  schema: typeof RISK_VETO_SHADOW_SCHEMA;
  logOnly: true;
  observedAt: string;
  decisionTimeMs: number;
  model: string;
  promptHash: string;
  latencyMs: number;
  valid: boolean;
  invalidReasons: string[];
  error: string | null;
  plan: RiskVetoPlanSnapshot;
  verdicts: RiskVetoVerdict[];
}

export interface RiskVetoShadowDeps {
  analyze?: (request: { systemPrompt: string; userPrompt: string; model: string }) => Promise<unknown>;
  persist?: (observation: RiskVetoObservation) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

export function isRiskVetoShadowEnabled(): boolean {
  return process.env.OPENROUTER_RISK_VETO_SHADOW === 'true';
}

export function getRiskVetoShadowModel(): string {
  return process.env.OPENROUTER_RISK_VETO_SHADOW_MODEL?.trim()
    || getOpenRouterShadowModel()
    || getOpenRouterDispatchModel();
}

function riskVetoTimeoutMs(): number {
  const n = Number(process.env.OPENROUTER_RISK_VETO_SHADOW_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1_000 ? Math.floor(n) : 20_000;
}

/** Research storage only; never inside the live ledger directory. */
export function riskVetoShadowDirectory(): string {
  const backendRoot = path.resolve(__dirname, '../..');
  return path.resolve(process.env.OPENROUTER_RISK_VETO_SHADOW_DIR
    || path.join(backendRoot, 'data/research/openrouter-risk-veto-shadow'));
}

export function riskVetoShadowFile(): string {
  return path.join(riskVetoShadowDirectory(), 'observations.ndjson');
}

async function appendObservation(observation: RiskVetoObservation): Promise<void> {
  const file = riskVetoShadowFile();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(observation)}\n`, 'utf8');
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const round = (value: number | null, digits = 6): number | null =>
  value === null ? null : Number(value.toFixed(digits));

/**
 * Build a detached plan snapshot from a source target and the closed daily
 * rows the worker already loaded. Pure; never mutates its inputs.
 */
export function buildRiskVetoPlanSnapshot(input: {
  target: {
    weights: Record<string, number>; decimalWeights?: Record<string, string>;
    knownAtMs: number; executeAtMs: number; sourceId: string; policyId?: string;
    metadata?: Record<string, { [key: string]: unknown }>;
  };
  closedDailyRows: ReadonlyArray<{ openTimeMs: number; closes: Record<string, number | null> }>;
}): RiskVetoPlanSnapshot {
  const { target, closedDailyRows } = input;
  const symbols = Object.keys(target.decimalWeights ?? target.weights);
  const legs = symbols.map((symbol): RiskVetoPlanLeg => {
    const decimal = target.decimalWeights?.[symbol];
    const weight = decimal !== undefined ? Number(decimal) : Number(target.weights[symbol] ?? 0);
    const closes = closedDailyRows.slice(-31).map(row => finite(row.closes[symbol]));
    const last = closes[closes.length - 1] ?? null;
    const back = (days: number): number | null => {
      const prior = closes[closes.length - 1 - days] ?? null;
      return last !== null && prior !== null && prior > 0 ? last / prior - 1 : null;
    };
    const logReturns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const a = closes[i - 1], b = closes[i];
      if (a !== null && b !== null && a > 0 && b > 0) logReturns.push(Math.log(b / a));
    }
    let realizedVol30: number | null = null;
    if (logReturns.length >= 2) {
      const mean = logReturns.reduce((s, x) => s + x, 0) / logReturns.length;
      const variance = logReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / (logReturns.length - 1);
      realizedVol30 = Math.sqrt(variance) * Math.sqrt(365);
    }
    const safeWeight = Number.isFinite(weight) ? weight : 0;
    return {
      symbol,
      side: safeWeight > 0 ? 'long' : safeWeight < 0 ? 'short' : 'flat',
      weight: safeWeight,
      price: last,
      return1d: round(back(1)), return7d: round(back(7)), return30d: round(back(30)),
      realizedVol30: round(realizedVol30),
      annVol90: round(finite(target.metadata?.[symbol]?.annVol90)),
    };
  });
  return {
    policyId: target.policyId ?? null, sourceId: target.sourceId,
    knownAtMs: target.knownAtMs, executeAtMs: target.executeAtMs, legs,
  };
}

export const RISK_VETO_SYSTEM_PROMPT = [
  'You are a crypto futures risk officer reviewing an already computed daily portfolio rebalance.',
  'You cannot change direction or add exposure. For each symbol decide only whether to keep the planned leg,',
  'reduce it, or veto it (size 0), and only for concrete tail risks: news_event, liquidation_cascade,',
  'extreme_funding, exchange_risk. Otherwise answer keep with reasonCode none.',
  'Reply with ONLY one valid minified JSON object: {"verdicts":[{"symbol":string,"action":"keep"|"reduce"|"veto",',
  '"sizeMultiplier":number 0..1,"confidence":number 0..1,',
  '"reasonCode":"news_event"|"liquidation_cascade"|"extreme_funding"|"exchange_risk"|"none","shortReason":string<=160 chars}]}.',
  'Return exactly one verdict per symbol in the plan.',
].join(' ');

export function buildRiskVetoUserPrompt(plan: RiskVetoPlanSnapshot): string {
  return JSON.stringify({
    task: 'risk_veto_review',
    decisionTime: new Date(plan.knownAtMs).toISOString(),
    executeAt: new Date(plan.executeAtMs).toISOString(),
    horizon: '24h until next daily rebalance',
    legs: plan.legs.map(leg => ({
      symbol: leg.symbol, side: leg.side, targetWeight: leg.weight, lastDailyClose: leg.price,
      return1d: leg.return1d, return7d: leg.return7d, return30d: leg.return30d,
      realizedVol30Ann: leg.realizedVol30, annVol90: leg.annVol90,
    })),
  });
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
function toNumber(value: unknown): number | null {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
}

/**
 * Strictly validate a model response. Missing/unknown fields make a verdict
 * invalid instead of being invented; numbers are clamped to 0..1. Never throws.
 */
export function parseRiskVetoResponse(raw: unknown, plan: RiskVetoPlanSnapshot): {
  verdicts: RiskVetoVerdict[]; invalidReasons: string[];
} {
  const invalidReasons: string[] = [];
  const object = typeof raw === 'string' ? parseLlmJsonObject(raw)
    : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!object) return { verdicts: [], invalidReasons: ['unparseable_json'] };
  const list = object.verdicts;
  if (!Array.isArray(list)) return { verdicts: [], invalidReasons: ['missing_verdicts_array'] };

  const planSymbols = new Set(plan.legs.map(leg => leg.symbol));
  const bySymbol = new Map<string, RiskVetoVerdict>();
  for (const item of list) {
    if (!item || typeof item !== 'object') { invalidReasons.push('verdict_not_object'); continue; }
    const v = item as Record<string, unknown>;
    const symbol = typeof v.symbol === 'string' ? v.symbol.trim().toUpperCase() : '';
    if (!planSymbols.has(symbol)) { invalidReasons.push(`unknown_symbol:${symbol || '?'}`); continue; }
    if (bySymbol.has(symbol)) { invalidReasons.push(`duplicate_symbol:${symbol}`); continue; }
    const action = v.action as RiskVetoAction;
    if (!RISK_VETO_ACTIONS.includes(action)) { invalidReasons.push(`bad_action:${symbol}`); continue; }
    const reasonCode = v.reasonCode as RiskVetoReasonCode;
    if (!RISK_VETO_REASON_CODES.includes(reasonCode)) { invalidReasons.push(`bad_reason_code:${symbol}`); continue; }
    const confidence = toNumber(v.confidence);
    if (confidence === null) { invalidReasons.push(`bad_confidence:${symbol}`); continue; }
    const rawMultiplier = toNumber(v.sizeMultiplier);
    if (action === 'reduce' && rawMultiplier === null) { invalidReasons.push(`bad_size_multiplier:${symbol}`); continue; }
    // The action defines the multiplier bounds; reduce is the only free value.
    const sizeMultiplier = action === 'veto' ? 0 : action === 'keep' ? 1 : clamp01(rawMultiplier!);
    bySymbol.set(symbol, {
      symbol, action, sizeMultiplier,
      // Accept 0..100 percent style the same way the dispatch shadow does.
      confidence: clamp01(confidence > 1 ? confidence / 100 : confidence),
      reasonCode,
      shortReason: typeof v.shortReason === 'string' ? v.shortReason.slice(0, 160) : '',
    });
  }
  for (const symbol of planSymbols) if (!bySymbol.has(symbol)) invalidReasons.push(`missing_symbol:${symbol}`);
  return { verdicts: plan.legs.flatMap(leg => bySymbol.get(leg.symbol) ?? []), invalidReasons };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`risk_veto_shadow_timeout_${ms}ms`)), ms);
    timer.unref?.();
    promise.then(value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); });
  });
}

const defaultAnalyze: NonNullable<RiskVetoShadowDeps['analyze']> = request =>
  withProviderPurpose('shadow', () => analyzeViaOpenRouter({
    systemPrompt: request.systemPrompt, userPrompt: request.userPrompt, model: request.model,
    temperature: 0.1, logLabel: 'Risk veto shadow', maxParseRetries: 1, responseFormat: 'json_object',
  }));

/**
 * Ask the model for verdicts on a detached plan snapshot and append one NDJSON
 * observation. Resolves (never rejects) with the observation, or null when
 * disabled or when persistence itself failed.
 */
export async function observeRiskVetoShadow(
  plan: RiskVetoPlanSnapshot, deps: RiskVetoShadowDeps = {},
): Promise<RiskVetoObservation | null> {
  try {
    if (!isRiskVetoShadowEnabled()) return null;
    const now = deps.now ?? Date.now;
    const snapshot: RiskVetoPlanSnapshot = JSON.parse(JSON.stringify(plan));
    const model = getRiskVetoShadowModel();
    const userPrompt = buildRiskVetoUserPrompt(snapshot);
    const promptHash = createHash('sha256').update(RISK_VETO_SYSTEM_PROMPT).update('\0').update(userPrompt).digest('hex');
    const started = now();
    let verdicts: RiskVetoVerdict[] = [], invalidReasons: string[] = [], error: string | null = null;
    try {
      const raw = await withTimeout(Promise.resolve().then(() => (deps.analyze ?? defaultAnalyze)({
        systemPrompt: RISK_VETO_SYSTEM_PROMPT, userPrompt, model })), deps.timeoutMs ?? riskVetoTimeoutMs());
      ({ verdicts, invalidReasons } = parseRiskVetoResponse(raw, snapshot));
    } catch (cause: unknown) {
      error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
      invalidReasons = ['provider_error'];
    }
    const observation: RiskVetoObservation = {
      schema: RISK_VETO_SHADOW_SCHEMA, logOnly: true,
      observedAt: new Date(now()).toISOString(), decisionTimeMs: snapshot.knownAtMs,
      model, promptHash, latencyMs: now() - started,
      valid: invalidReasons.length === 0, invalidReasons, error, plan: snapshot, verdicts,
    };
    await (deps.persist ?? appendObservation)(observation);
    return observation;
  } catch (cause: unknown) {
    console.warn(`[RiskVetoShadow] observation not persisted: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

const scheduledKeys = new Set<string>();
let inFlight = false;

/**
 * Fire-and-forget entry for the live worker. Synchronous, never throws, never
 * awaited; at most one request in flight and one observation per source day.
 */
export function scheduleRiskVetoShadow(
  buildPlan: () => RiskVetoPlanSnapshot, deps: RiskVetoShadowDeps = {},
): Promise<RiskVetoObservation | null> | null {
  try {
    if (!isRiskVetoShadowEnabled() || inFlight) return null;
    const plan = buildPlan();
    const key = `${plan.sourceId}:${plan.executeAtMs}`;
    if (scheduledKeys.has(key)) return null;
    scheduledKeys.add(key);
    inFlight = true;
    return observeRiskVetoShadow(plan, deps).finally(() => { inFlight = false; });
  } catch {
    inFlight = false;
    return null;
  }
}

/** Test helper; clears the per-process de-duplication state. */
export function resetRiskVetoShadowStateForTests(): void {
  scheduledKeys.clear();
  inFlight = false;
}
