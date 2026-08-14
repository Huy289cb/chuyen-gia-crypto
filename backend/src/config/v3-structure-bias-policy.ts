/**
 * Structure-first bias permission (Phase A).
 * See docs/structure-first-bias-plan.md
 */

import {
  classifyStructureBias,
  type StructureBias,
  type StructureBiasResult,
  type StructureCandle,
} from '../utils/structure-bias';

export type { StructureBias, StructureBiasResult };

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
 * bull → long only; bear → short only; transition → flat.
 */
export function evaluateStructureSidePermission(input: {
  side: 'long' | 'short';
  candles: StructureCandle[];
  enabled?: boolean;
  strength?: number;
}): StructureSidePermission {
  const enabled = input.enabled ?? isV3StructureBiasEnabled();
  if (!enabled) {
    return { pass: true, bias: 'transition', reason: 'structure bias disabled' };
  }

  const detail = classifyStructureBias(input.candles, {
    strength: input.strength ?? getV3StructureBiasStrength(),
  });
  const { bias } = detail;

  if (bias === 'transition') {
    return {
      pass: false,
      bias,
      reason: `blocked: structure transition — flat (${detail.reason}) (V3_STRUCTURE_BIAS)`,
      detail,
    };
  }
  if (bias === 'bull' && input.side === 'long') {
    return { pass: true, bias, reason: `structure bull allows long (${detail.reason})`, detail };
  }
  if (bias === 'bear' && input.side === 'short') {
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
