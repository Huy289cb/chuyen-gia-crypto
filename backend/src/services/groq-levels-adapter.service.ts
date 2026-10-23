import {withProviderPurpose} from '../utils/provider-purpose-context';
/**
 * Secondary Groq pass (GROQ_API_KEY_2):
 * - Min SL fail → repair only within the original structural target.
 * - Fixed entry/SL with insufficient R:R cannot be repaired by extending that target.
 * Invoked only when GROQ_LEVELS_ADAPTER_ENABLED=true and key 2 is set.
 */

import { createGroqClient } from './groq-client';
import type { GroqAnalysis } from './groq-client';
import {
  checkMinSlDistance,
  computeExpectedRrFromPrices,
  computeMinTakeProfitForRr,
  computePolicyCompliantStopAndTarget,
  reconcileExpectedRr,
} from '../utils/trade-levels';
import { getMethodConfig } from '../config/methods';
import { getRiskPolicy } from '../config/risk-policy';
import { getGroqLevelsAdapterModel } from '../config/groq-models';
import {
  getOpenRouterLevelsAdapterModel,
  isOpenRouterLevelsAdapterProvider,
} from '../config/openrouter-models';

export function isLevelsAdapterConfigured(): boolean {
  if (process.env.GROQ_LEVELS_ADAPTER_ENABLED !== 'true') return false;
  if (isOpenRouterLevelsAdapterProvider()) {
    return !!process.env.OPENROUTER_API_KEY?.trim();
  }
  return !!process.env.GROQ_API_KEY_2?.trim();
}

/** @deprecated use isLevelsAdapterConfigured */
export function isGroqLevelsAdapterConfigured(): boolean {
  return isLevelsAdapterConfigured();
}

function adapterModelId(): string {
  if (isOpenRouterLevelsAdapterProvider()) {
    return getOpenRouterLevelsAdapterModel();
  }
  return getGroqLevelsAdapterModel();
}

async function callLevelsAdapterLLM(input: {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
}): Promise<GroqAnalysis | null> {
  if (!isLevelsAdapterConfigured()) return null;

  if (isOpenRouterLevelsAdapterProvider()) {
    try {
      const { analyzeViaOpenRouter } = await import('./openrouter-client');
      return await analyzeViaOpenRouter({
        ...input,
        model: adapterModelId(),
        logLabel: 'Levels adapter',
      });
    } catch (e: unknown) {
      console.warn('[LevelsAdapter] OpenRouter call failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  const key2 = process.env.GROQ_API_KEY_2?.trim();
  if (!key2) return null;
  const client = createGroqClient([key2]);
  if (!client) return null;

  try {
    return await client.analyze({
      ...input,
      maxRetries: 1,
      preferredModels: [adapterModelId()],
    });
  } catch (e: unknown) {
    console.warn('[LevelsAdapter] Groq call failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

function validateAndMergeRepairedLevels(input: {
  action: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  minSlPct: number;
  minRr: number;
  analysis: GroqAnalysis;
  auditTag: string;
  note: string;
}): GroqAnalysis | null {
  const { action, entry, minSlPct, minRr, analysis, auditTag, note } = input;
  let nSl = input.sl;
  let nTp = input.tp;

  if (action === 'buy') {
    if (!(nSl < entry && nTp > entry)) {
      console.warn(`[LevelsAdapter] ${auditTag} LONG geometry invalid`);
      return null;
    }
  } else if (!(nSl > entry && nTp < entry)) {
    console.warn(`[LevelsAdapter] ${auditTag} SHORT geometry invalid`);
    return null;
  }

  const originalTp = Number(analysis.suggested_take_profit);
  if (!Number.isFinite(originalTp) || (action === 'buy' ? nTp > originalTp : nTp < originalTp)) {
    console.warn('[LevelsAdapter] Repair would extend target beyond the original structural target');
    return null;
  }

  const slCheck = checkMinSlDistance(entry, nSl, minSlPct);
  if (!slCheck.ok) {
    console.warn(
      `[LevelsAdapter] ${auditTag} SL still below min: ${(slCheck.distancePct * 100).toFixed(3)}% < ${(minSlPct * 100).toFixed(2)}%`
    );
    return null;
  }

  const rr = computeExpectedRrFromPrices(entry, nSl, nTp);
  if (rr == null || rr + 1e-9 < minRr) {
    console.warn(
      `[LevelsAdapter] ${auditTag} R:R insufficient: ${rr == null ? 'null' : rr.toFixed(2)} < ${minRr}`
    );
    return null;
  }

  const merged: GroqAnalysis = {
    ...analysis,
    suggested_stop_loss: Math.round(nSl * 100) / 100,
    suggested_take_profit: Math.round(nTp * 100) / 100,
    reason_summary: [analysis.reason_summary, `[LevelsAdapter:${auditTag}] ${note}`]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500),
  };

  const { analysis: withRr } = reconcileExpectedRr(merged);
  return withRr;
}

/** Exported for prompt regression tests. */
export function buildAdapterPrompts(input: {
  symbol: string;
  timeframe: string;
  action: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  minSlPct: number;
  minRr: number;
}): { systemPrompt: string; userPrompt: string } {
  const isLong = input.action === 'buy';
  const minSlLabel = (input.minSlPct * 100).toFixed(2);
  const minSlAbs = Math.round(input.entry * input.minSlPct * 100) / 100;
  const floor = computePolicyCompliantStopAndTarget({
    action: input.action,
    entry: input.entry,
    minSlPct: input.minSlPct,
    minRr: input.minRr,
  });

  const slFloorLine = floor
    ? isLong
      ? `MANDATORY SL ceiling (LONG): suggested_stop_loss <= ${floor.stopLoss} (entry ${input.entry} − ${minSlAbs} = ${minSlLabel}% distance).`
      : `MANDATORY SL floor (SHORT): suggested_stop_loss >= ${floor.stopLoss} (entry ${input.entry} + ${minSlAbs} = ${minSlLabel}% distance).`
    : '';

  const tpHint = floor
    ? `Reference TP at min R:R ${input.minRr}: ${floor.takeProfit} (adjust if needed but keep R:R >= ${input.minRr}).`
    : '';

  const verifyLine = isLong
    ? `SELF-CHECK before JSON: (entry - suggested_stop_loss) / entry >= ${input.minSlPct} (${minSlLabel}%) AND suggested_stop_loss < entry.`
    : `SELF-CHECK before JSON: (suggested_stop_loss - entry) / entry >= ${input.minSlPct} (${minSlLabel}%) AND suggested_stop_loss > entry.`;

  const systemPrompt = `You are an execution risk specialist for crypto perpetuals.
The primary analyst proposed trade levels but STOP LOSS is too close to ENTRY.

Output: ONE JSON object only (no markdown, no btc wrapper), exactly these keys:
- suggested_stop_loss (number, 2 decimals)
- suggested_take_profit (number, 2 decimals)
- adjustment_note (string, max 120 chars)

Symbol ${input.symbol}, timeframe ${input.timeframe}, side ${input.action.toUpperCase()}:
${
    isLong
      ? 'LONG — stop_loss strictly BELOW entry; take_profit strictly ABOVE entry.'
      : 'SHORT — stop_loss strictly ABOVE entry; take_profit strictly BELOW entry.'
  }
Entry FIXED at ${input.entry} — do not output entry.
Original structural TP bound: ${input.tp}.
${isLong ? 'Do not raise take_profit above' : 'Do not lower take_profit below'} ${input.tp}; do not extend the original target to manufacture R:R.

Distance rule (server rejects tighter stops):
  |entry - suggested_stop_loss| / entry >= ${input.minSlPct}  (${minSlLabel}%).
${slFloorLine}
R:R rule (compute from your numbers, 2 decimals):
  |suggested_take_profit - entry| / |entry - suggested_stop_loss| >= ${input.minRr}.
${tpHint}
${verifyLine}
Widen SL away from entry (SHORT: move SL higher than current; LONG: move SL lower than current).`;

  const curPct = (Math.abs(input.entry - input.sl) / input.entry) * 100;
  const userPrompt = `PRIMARY_MODEL_LEVELS (SL too tight — must meet policy floor):
action=${input.action}
entry=${input.entry}
current_stop_loss=${input.sl}  (|entry-SL|/entry=${curPct.toFixed(3)}%, need >=${minSlLabel}%)
current_take_profit=${input.tp}
min_risk_usd=${minSlAbs}
${floor ? `policy_floor_sl=${floor.stopLoss}` : ''}
${floor ? `policy_ref_tp_rr${input.minRr}=${floor.takeProfit}` : ''}

Return JSON only with suggested_stop_loss, suggested_take_profit, adjustment_note.`;

  return { systemPrompt, userPrompt };
}

/** Exported for prompt regression tests. */
export function buildRrOnlyTpAdapterPrompts(input: {
  symbol: string;
  timeframe: string;
  action: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  minSlPct: number;
  minRr: number;
  currentRr: number;
}): { systemPrompt: string; userPrompt: string } {
  const isLong = input.action === 'buy';
  const risk = Math.abs(input.entry - input.sl);
  const minTp = computeMinTakeProfitForRr({
    action: input.action,
    entry: input.entry,
    stopLoss: input.sl,
    minRr: input.minRr,
  });

  const tpBound = minTp
    ? isLong
      ? `MANDATORY TP floor (LONG): suggested_take_profit >= ${minTp} (entry + risk×${input.minRr}, risk=${risk.toFixed(2)}).`
      : `MANDATORY TP ceiling (SHORT): suggested_take_profit <= ${minTp} (entry − risk×${input.minRr}, risk=${risk.toFixed(2)}).`
    : '';

  const systemPrompt = `You are an execution risk specialist. SL distance is OK; R:R from prices is too low.

Output: ONE JSON object only (no markdown), keys:
- suggested_take_profit (number, 2 decimals) — ONLY field you may change
- adjustment_note (string, max 120 chars)

${input.symbol} ${input.timeframe}, ${input.action.toUpperCase()}:
Entry FIXED ${input.entry}. Stop loss FIXED ${input.sl} — do NOT output suggested_stop_loss.
${tpBound}
R:R: |suggested_take_profit - entry| / ${risk.toFixed(2)} >= ${input.minRr}.
SELF-CHECK: recompute R:R from your TP before replying.`;

  const userPrompt = `PRIMARY_MODEL_LEVELS (adjust TP only):
action=${input.action}
entry=${input.entry}
stop_loss=${input.sl} (fixed)
current_take_profit=${input.tp}
current_rr=${input.currentRr.toFixed(3)} (minimum ${input.minRr})
${minTp != null ? `policy_min_tp=${minTp}` : ''}

Return JSON with suggested_take_profit and adjustment_note only.`;

  return { systemPrompt, userPrompt };
}

/**
 * If primary analysis fails min SL, ask secondary key to propose wider SL + compatible TP.
 * Returns updated analysis or null (caller keeps no_trade path).
 */
export async function tryRepairLevelsWithSecondaryKey(input: {
  symbol: string;
  timeframe: string;
  methodId: string;
  analysis: GroqAnalysis;
}): Promise<GroqAnalysis | null> {
  if (!isLevelsAdapterConfigured()) return null;

  const actionRaw = String(input.analysis.action || '').toLowerCase();
  if (actionRaw !== 'buy' && actionRaw !== 'sell') return null;

  const action = actionRaw as 'buy' | 'sell';
  const entry = Number(input.analysis.suggested_entry);
  const sl0 = Number(input.analysis.suggested_stop_loss);
  const tp0 = Number(input.analysis.suggested_take_profit);
  if (!Number.isFinite(entry) || !Number.isFinite(sl0) || !Number.isFinite(tp0)) return null;

  const minSlPct = getRiskPolicy().minSlDistancePercent;
  if (checkMinSlDistance(entry, sl0, minSlPct).ok) return null;

  const minRr = getMethodConfig(input.methodId).autoEntry.minRRRatio;
  const floor = computePolicyCompliantStopAndTarget({ action, entry, minSlPct, minRr });
  if (!floor || (action === 'buy' ? tp0 + 1e-9 < floor.takeProfit : tp0 - 1e-9 > floor.takeProfit)) {
    console.warn('[LevelsAdapter] Original structural target cannot support the minimum SL and R:R; skipping repair');
    return null;
  }
  const { systemPrompt, userPrompt } = buildAdapterPrompts({
    symbol: input.symbol,
    timeframe: input.timeframe,
    action,
    entry,
    sl: sl0,
    tp: tp0,
    minSlPct,
    minRr,
  });

  let raw: GroqAnalysis | null;
  try {
    raw = await withProviderPurpose('levels_repair', () => callLevelsAdapterLLM({
      systemPrompt,
      userPrompt,
      temperature: 0.12,
    }));
  } catch (e: unknown) {
    console.warn('[LevelsAdapter] adapter call failed:', e instanceof Error ? e.message : e);
    return null;
  }
  if (!raw) return null;

  let nSl = Number(raw.suggested_stop_loss);
  let nTp = Number(raw.suggested_take_profit);
  if (!Number.isFinite(nSl) || !Number.isFinite(nTp)) {
    console.warn('[LevelsAdapter] Non-numeric SL/TP from adapter');
    return null;
  }

  const llmNote =
    typeof (raw as { adjustment_note?: string }).adjustment_note === 'string'
      ? String((raw as { adjustment_note?: string }).adjustment_note).slice(0, 120)
      : 'levels widened to meet policy';

  const repaired = validateAndMergeRepairedLevels({
    action,
    entry,
    sl: nSl,
    tp: nTp,
    minSlPct,
    minRr,
    analysis: input.analysis,
    auditTag: 'key2',
    note: llmNote,
  });

  if (!repaired) return null;

  console.log(
    `[LevelsAdapter] OK ${input.symbol} ${input.timeframe} ${action} SL ${sl0}→${repaired.suggested_stop_loss} TP ${tp0}→${repaired.suggested_take_profit} rr≈${repaired.expected_rr}`
  );
  return repaired;
}

/**
 * Compatibility entrypoint: fixed entry/SL and an insufficient original target
 * cannot meet minimum R:R without extending that target. Keep no_trade without an LLM call.
 */
export async function tryRepairTpForMinRrWithSecondaryKey(input: {
  symbol: string;
  timeframe: string;
  methodId: string;
  analysis: GroqAnalysis;
}): Promise<GroqAnalysis | null> {
  if (!isLevelsAdapterConfigured()) return null;

  const actionRaw = String(input.analysis.action || '').toLowerCase();
  if (actionRaw !== 'buy' && actionRaw !== 'sell') return null;

  const entry = Number(input.analysis.suggested_entry);
  const sl0 = Number(input.analysis.suggested_stop_loss);
  const tp0 = Number(input.analysis.suggested_take_profit);
  if (!Number.isFinite(entry) || !Number.isFinite(sl0) || !Number.isFinite(tp0)) return null;

  const minSlPct = getRiskPolicy().minSlDistancePercent;
  if (!checkMinSlDistance(entry, sl0, minSlPct).ok) return null;

  const minRr = getMethodConfig(input.methodId).autoEntry.minRRRatio;
  const curRr = computeExpectedRrFromPrices(entry, sl0, tp0);
  if (curRr == null || curRr + 1e-9 >= minRr) return null;

  console.warn('[LevelsAdapter:RR] Fixed entry/SL cannot reach minimum R:R within the original structural target; skipping repair');
  return null;
}
