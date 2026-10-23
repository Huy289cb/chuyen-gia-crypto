/**
 * Structure-first bias permission (Phase A).
 * See docs/structure-first-bias-plan.md
 */

import {
  classifyStructureBias,
  hasBearishStructureBreak,
  hasBullishStructureBreak,
  type StructureBias,
  type StructureBiasResult,
  type StructureCandle,
} from '../utils/structure-bias';

export type { StructureBias, StructureBiasResult };

/** Short needs LH+LL + BOS (close below prior swing low). Default on. */
export function isV3StructureShortRequireBos(): boolean {
  return process.env.V3_STRUCTURE_SHORT_REQUIRE_BOS !== 'false';
}

/** Long needs HH+HL + BOS (close above prior swing high). Default on — mirror short. */
export function isV3StructureLongRequireBos(): boolean {
  return process.env.V3_STRUCTURE_LONG_REQUIRE_BOS !== 'false';
}

export function isV3StructureBiasEnabled(): boolean {
  return process.env.V3_STRUCTURE_BIAS_ENABLED !== 'false';
}

export function getV3StructureBiasTf(): string {
  return process.env.V3_STRUCTURE_BIAS_TF?.trim() || '4h';
}

export function getV3StructureBiasStrength(): number {
  const v = parseInt(process.env.V3_STRUCTURE_BIAS_STRENGTH || '2', 10);
  return Number.isFinite(v) && v >= 1 ? v : 2;
}

/** Candle limit for structure TF (need room for pivots). */
export function getV3StructureBiasCandleLimit(): number {
  const v = parseInt(process.env.V3_STRUCTURE_BIAS_CANDLE_LIMIT || '120', 10);
  return Number.isFinite(v) && v >= 40 ? v : 120;
}

export interface StructureSidePermission {
  pass: boolean;
  bias: StructureBias;
  reason?: string;
  detail?: StructureBiasResult;
}

/**
 * bull → long only (+BOS); bear → short only (+BOS); transition → flat.
 * Short: block LH+LL reclaim (Aug-24). Long: block HH+HL relief in bear (Aug 8–12 mirror).
 */
export function evaluateStructureSidePermission(input: {
  side: 'long' | 'short';
  candles: StructureCandle[];
  enabled?: boolean;
  strength?: number;
  shortRequireBos?: boolean;
  longRequireBos?: boolean;
}): StructureSidePermission {
  const enabled = input.enabled ?? isV3StructureBiasEnabled();
  if (!enabled) {
    return { pass: true, bias: 'transition', reason: 'structure bias disabled' };
  }

  const detail = classifyStructureBias(input.candles, {
    strength: input.strength ?? getV3StructureBiasStrength(),
  });
  const { bias } = detail;
  const last = input.candles[input.candles.length - 1];
  const lastClose = last?.close ?? (input.side === 'short' ? last?.low : last?.high);

  if (bias === 'transition') {
    return {
      pass: false,
      bias,
      reason: `blocked: structure transition — flat (${detail.reason}) (V3_STRUCTURE_BIAS)`,
      detail,
    };
  }
  if (bias === 'bull' && input.side === 'long') {
    const requireBos = input.longRequireBos ?? isV3StructureLongRequireBos();
    if (requireBos) {
      if (lastClose == null || !hasBullishStructureBreak(detail, lastClose)) {
        const prior = detail.swingHighs[0];
        return {
          pass: false,
          bias,
          reason:
            `blocked: bull HH+HL but no BOS (close ${lastClose ?? 'n/a'} ≤ prior high ${prior}) ` +
            `(V3_STRUCTURE_LONG_REQUIRE_BOS)`,
          detail,
        };
      }
    }
    return { pass: true, bias, reason: `structure bull allows long (${detail.reason})`, detail };
  }
  if (bias === 'bear' && input.side === 'short') {
    const requireBos = input.shortRequireBos ?? isV3StructureShortRequireBos();
    if (requireBos) {
      if (lastClose == null || !hasBearishStructureBreak(detail, lastClose)) {
        const prior = detail.swingLows[0];
        return {
          pass: false,
          bias,
          reason:
            `blocked: bear LH+LL but no BOS (close ${lastClose ?? 'n/a'} ≥ prior low ${prior}) ` +
            `(V3_STRUCTURE_SHORT_REQUIRE_BOS)`,
          detail,
        };
      }
    }
    return { pass: true, bias, reason: `structure bear allows short (${detail.reason})`, detail };
  }
  return {
    pass: false,
    bias,
    reason: `blocked: ${input.side} against structure ${bias} (${detail.reason}) (V3_STRUCTURE_BIAS)`,
    detail,
  };
}

/** Playbook direction must match LLM side (Phase B). Default on. */
export function isV3RequirePlaybookSideMatch(): boolean {
  return process.env.V3_REQUIRE_PLAYBOOK_SIDE_MATCH !== 'false';
}

export interface PlaybookSideMatchResult {
  pass: boolean;
  reason?: string;
}

export function evaluatePlaybookSideMatch(input: {
  llmSide: 'long' | 'short';
  playbookSide: 'long' | 'short' | null;
  enabled?: boolean;
}): PlaybookSideMatchResult {
  const enabled = input.enabled ?? isV3RequirePlaybookSideMatch();
  if (!enabled) return { pass: true };
  if (!input.playbookSide) {
    return {
      pass: false,
      reason: 'blocked: playbook has no direction (V3_REQUIRE_PLAYBOOK_SIDE_MATCH)',
    };
  }
  if (input.playbookSide !== input.llmSide) {
    return {
      pass: false,
      reason: `blocked: LLM ${input.llmSide} ≠ playbook ${input.playbookSide} (V3_REQUIRE_PLAYBOOK_SIDE_MATCH)`,
    };
  }
  return { pass: true, reason: `playbook ${input.playbookSide} matches LLM` };
}

/** Facts for LLM confirm/veto — do not let the model invent HTF/playbook. */
export function formatLlmGateContext(input: {
  timeframe: string;
  playbookKey: string;
  playbookSide: 'long' | 'short' | null;
  structureBias?: 'bull' | 'bear' | 'transition';
  htfTf?: string;
  htfRegime?: string;
  htfDirection?: string | null;
}): string {
  const side = input.playbookSide ?? 'unknown';
  const confirm =
    side === 'long' ? 'buy' : side === 'short' ? 'sell' : 'hold';
  const lines = [
    'GATE CONTEXT (deterministic — do not contradict):',
    `- Entry TF: ${input.timeframe}`,
    `- Playbook: ${input.playbookKey} → side ${side}`,
  ];
  if (input.structureBias) {
    lines.push(`- Structure bias (4h): ${input.structureBias}`);
  }
  if (input.htfTf) {
    lines.push(
      `- HTF ${input.htfTf}: ${input.htfRegime ?? 'unknown'}/${input.htfDirection ?? 'null'}`
    );
  }
  lines.push(
    `- Confirm ONLY "${confirm}" (with SL/TP) or "hold". Never the opposite side.`,
    '- Hold is a valid veto. Do not invent BOS/CHOCH/OB/FVG/Fibo numbers.'
  );
  return lines.join('\n');
}
