/**
 * Secondary Groq pass (GROQ_API_KEY_2):
 * - Min SL fail → widen SL + TP (`tryRepairLevelsWithSecondaryKey`).
 * - SL OK but R:R low → adjust TP only (`tryRepairTpForMinRrWithSecondaryKey`, Step 5b).
 * Invoked only when GROQ_LEVELS_ADAPTER_ENABLED=true and key 2 is set.
 */

import { createGroqClient } from './groq-client';
import type { GroqAnalysis } from './groq-client';
import {
  checkMinSlDistance,
  computeExpectedRrFromPrices,
  reconcileExpectedRr,
} from '../utils/trade-levels';
import { getMethodConfig } from '../config/methods';
import { getRiskPolicy } from '../config/risk-policy';

const DEFAULT_ADAPTER_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export function isGroqLevelsAdapterConfigured(): boolean {
  return (
    process.env.GROQ_LEVELS_ADAPTER_ENABLED === 'true' && !!process.env.GROQ_API_KEY_2?.trim()
  );
}

function adapterModelId(): string {
  return (
    process.env.GROQ_MODEL_LEVELS_ADAPTER?.trim() ||
    process.env.GROQ_MODEL_PRIMARY?.trim() ||
    DEFAULT_ADAPTER_MODEL
  );
}

function buildAdapterPrompts(input: {
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

  const systemPrompt = `You are an execution risk specialist for crypto perpetuals (Kim Nghia pipeline).
The primary analyst model proposed a trade but STOP LOSS is too close to ENTRY (below system minimum).

Reply with ONE JSON object only (no markdown), keys:
- suggested_stop_loss (number)
- suggested_take_profit (number)
- adjustment_note (string, max 220 chars)

Hard rules:
- Symbol ${input.symbol}, timeframe ${input.timeframe}.
- Side ${input.action.toUpperCase()}: ${
    isLong
      ? 'LONG — stop_loss MUST be strictly BELOW entry; take_profit strictly ABOVE entry.'
      : 'SHORT — stop_loss MUST be strictly ABOVE entry; take_profit strictly BELOW entry.'
  }
- Entry is FIXED at ${input.entry}. Never change entry in output (only SL/TP keys).
- Require |entry - suggested_stop_loss| / entry >= ${minSlLabel}%.
- Require reward/risk from prices: |suggested_take_profit - entry| / |entry - suggested_stop_loss| >= ${input.minRr} (use the numbers you output).
- Widen SL in the correct direction (away from entry vs current tight SL). Adjust TP if needed to keep R:R >= ${input.minRr} while staying realistic.`;

  const curPct = (Math.abs(input.entry - input.sl) / input.entry) * 100;
  const userPrompt = `PRIMARY_MODEL_LEVELS (too tight on SL):
action=${input.action}
entry=${input.entry}
suggested_stop_loss=${input.sl}
suggested_take_profit=${input.tp}

Current |entry - SL| / entry = ${curPct.toFixed(3)}% (minimum ${minSlLabel}%).

Return JSON only.`;

  return { systemPrompt, userPrompt };
}

function buildRrOnlyTpAdapterPrompts(input: {
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
  const minSlLabel = (input.minSlPct * 100).toFixed(2);

  const systemPrompt = `You are an execution risk specialist for crypto perpetuals (Kim Nghia pipeline).
The primary analyst proposed a trade where STOP LOSS distance is acceptable but REWARD:RISK from prices is below the system minimum.

Reply with ONE JSON object only (no markdown), keys:
- suggested_take_profit (number) — REQUIRED; this is the ONLY price you may change.
- adjustment_note (string, max 220 chars)

Hard rules:
- Symbol ${input.symbol}, timeframe ${input.timeframe}.
- Side ${input.action.toUpperCase()}: ${
    isLong
      ? 'LONG — take_profit MUST be strictly ABOVE entry.'
      : 'SHORT — take_profit MUST be strictly BELOW entry.'
  }
- Entry is FIXED at ${input.entry}. Stop loss is FIXED at ${input.sl} — do NOT move SL; do not output suggested_stop_loss.
- SL distance |entry - SL| / entry is already >= ${minSlLabel}% — keep that true by not changing SL (caller enforces SL).
- From prices, require |suggested_take_profit - entry| / |entry - SL| >= ${input.minRr}.
- Move take profit further in the profit direction (vs current TP) enough to meet R:R >= ${input.minRr}; stay realistic for ${input.timeframe}.`;

  const userPrompt = `PRIMARY_MODEL_LEVELS (R:R too low; SL is acceptable, adjust TP only):
action=${input.action}
entry=${input.entry}
suggested_stop_loss=${input.sl}  (FIXED — do not change)
suggested_take_profit=${input.tp}

Current R:R from prices ≈ ${input.currentRr.toFixed(3)} (minimum ${input.minRr}).

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
  if (!isGroqLevelsAdapterConfigured()) return null;

  const actionRaw = String(input.analysis.action || '').toLowerCase();
  if (actionRaw !== 'buy' && actionRaw !== 'sell') return null;

  const action = actionRaw as 'buy' | 'sell';
  const entry = Number(input.analysis.suggested_entry);
  const sl0 = Number(input.analysis.suggested_stop_loss);
  const tp0 = Number(input.analysis.suggested_take_profit);
  if (!Number.isFinite(entry) || !Number.isFinite(sl0) || !Number.isFinite(tp0)) return null;

  const minSlPct = getRiskPolicy().minSlDistancePercent;
  if (checkMinSlDistance(entry, sl0, minSlPct).ok) return null;

  const key2 = process.env.GROQ_API_KEY_2!.trim();
  const client = createGroqClient([key2]);
  if (!client) return null;

  const minRr = getMethodConfig(input.methodId).autoEntry.minRRRatio;
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

  let raw: GroqAnalysis;
  try {
    raw = await client.analyze({
      systemPrompt,
      userPrompt,
      temperature: 0.12,
      maxRetries: 1,
      preferredModels: [adapterModelId()],
    });
  } catch (e: unknown) {
    console.warn('[LevelsAdapter] Groq call failed:', e instanceof Error ? e.message : e);
    return null;
  }

  const nSl = Number(raw.suggested_stop_loss);
  const nTp = Number(raw.suggested_take_profit);
  if (!Number.isFinite(nSl) || !Number.isFinite(nTp)) {
    console.warn('[LevelsAdapter] Non-numeric SL/TP from adapter');
    return null;
  }

  if (action === 'buy') {
    if (!(nSl < entry && nTp > entry)) {
      console.warn('[LevelsAdapter] LONG geometry invalid');
      return null;
    }
  } else if (!(nSl > entry && nTp < entry)) {
    console.warn('[LevelsAdapter] SHORT geometry invalid');
    return null;
  }

  const slCheck = checkMinSlDistance(entry, nSl, minSlPct);
  if (!slCheck.ok) {
    console.warn(
      `[LevelsAdapter] SL still below min: ${(slCheck.distancePct * 100).toFixed(3)}% < ${(minSlPct * 100).toFixed(2)}%`
    );
    return null;
  }

  const rr = computeExpectedRrFromPrices(entry, nSl, nTp);
  if (rr == null || rr + 1e-9 < minRr) {
    console.warn(`[LevelsAdapter] R:R insufficient: ${rr == null ? 'null' : rr.toFixed(2)} < ${minRr}`);
    return null;
  }

  const note =
    typeof (raw as { adjustment_note?: string }).adjustment_note === 'string'
      ? String((raw as { adjustment_note?: string }).adjustment_note).slice(0, 220)
      : 'levels widened to meet policy';

  const merged: GroqAnalysis = {
    ...input.analysis,
    suggested_stop_loss: Math.round(nSl * 100) / 100,
    suggested_take_profit: Math.round(nTp * 100) / 100,
    reason_summary: [
      input.analysis.reason_summary,
      `[LevelsAdapter:key2] ${note}`,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500),
  };

  const { analysis: withRr } = reconcileExpectedRr(merged);
  console.log(
    `[LevelsAdapter] OK ${input.symbol} ${input.timeframe} ${action} SL ${sl0}→${withRr.suggested_stop_loss} TP ${tp0}→${withRr.suggested_take_profit} rr≈${withRr.expected_rr}`
  );
  return withRr;
}

/**
 * When SL passes min distance but price-derived R:R is below method minimum, ask key2 for a new TP only.
 * SL from primary analysis is preserved.
 */
export async function tryRepairTpForMinRrWithSecondaryKey(input: {
  symbol: string;
  timeframe: string;
  methodId: string;
  analysis: GroqAnalysis;
}): Promise<GroqAnalysis | null> {
  if (!isGroqLevelsAdapterConfigured()) return null;

  const actionRaw = String(input.analysis.action || '').toLowerCase();
  if (actionRaw !== 'buy' && actionRaw !== 'sell') return null;

  const action = actionRaw as 'buy' | 'sell';
  const entry = Number(input.analysis.suggested_entry);
  const sl0 = Number(input.analysis.suggested_stop_loss);
  const tp0 = Number(input.analysis.suggested_take_profit);
  if (!Number.isFinite(entry) || !Number.isFinite(sl0) || !Number.isFinite(tp0)) return null;

  const minSlPct = getRiskPolicy().minSlDistancePercent;
  if (!checkMinSlDistance(entry, sl0, minSlPct).ok) return null;

  const minRr = getMethodConfig(input.methodId).autoEntry.minRRRatio;
  const curRr = computeExpectedRrFromPrices(entry, sl0, tp0);
  if (curRr == null || curRr + 1e-9 >= minRr) return null;

  const key2 = process.env.GROQ_API_KEY_2!.trim();
  const client = createGroqClient([key2]);
  if (!client) return null;

  const { systemPrompt, userPrompt } = buildRrOnlyTpAdapterPrompts({
    symbol: input.symbol,
    timeframe: input.timeframe,
    action,
    entry,
    sl: sl0,
    tp: tp0,
    minSlPct,
    minRr,
    currentRr: curRr,
  });

  let raw: GroqAnalysis;
  try {
    raw = await client.analyze({
      systemPrompt,
      userPrompt,
      temperature: 0.12,
      maxRetries: 1,
      preferredModels: [adapterModelId()],
    });
  } catch (e: unknown) {
    console.warn('[LevelsAdapter:RR] Groq call failed:', e instanceof Error ? e.message : e);
    return null;
  }

  const nTp = Number(raw.suggested_take_profit);
  if (!Number.isFinite(nTp)) {
    console.warn('[LevelsAdapter:RR] Non-numeric TP from adapter');
    return null;
  }

  if (action === 'buy') {
    if (!(nTp > entry)) {
      console.warn('[LevelsAdapter:RR] LONG: TP must be above entry');
      return null;
    }
  } else if (!(nTp < entry)) {
    console.warn('[LevelsAdapter:RR] SHORT: TP must be below entry');
    return null;
  }

  const slCheck = checkMinSlDistance(entry, sl0, minSlPct);
  if (!slCheck.ok) {
    console.warn('[LevelsAdapter:RR] SL invariant broken (should not happen)');
    return null;
  }

  const rr = computeExpectedRrFromPrices(entry, sl0, nTp);
  if (rr == null || rr + 1e-9 < minRr) {
    console.warn(`[LevelsAdapter:RR] R:R still insufficient: ${rr == null ? 'null' : rr.toFixed(2)} < ${minRr}`);
    return null;
  }

  const note =
    typeof (raw as { adjustment_note?: string }).adjustment_note === 'string'
      ? String((raw as { adjustment_note?: string }).adjustment_note).slice(0, 220)
      : 'TP adjusted to meet min R:R';

  const merged: GroqAnalysis = {
    ...input.analysis,
    suggested_stop_loss: Math.round(sl0 * 100) / 100,
    suggested_take_profit: Math.round(nTp * 100) / 100,
    reason_summary: [
      input.analysis.reason_summary,
      `[LevelsAdapter:key2:rr-tp] ${note}`,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500),
  };

  const { analysis: withRr } = reconcileExpectedRr(merged);
  console.log(
    `[LevelsAdapter:RR] OK ${input.symbol} ${input.timeframe} ${action} SL fixed=${withRr.suggested_stop_loss} TP ${tp0}→${withRr.suggested_take_profit} rr≈${withRr.expected_rr}`
  );
  return withRr;
}
