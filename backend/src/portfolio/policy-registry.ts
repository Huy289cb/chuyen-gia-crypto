import type { Numeric, PortfolioPaperConfig, SymbolFilter } from './types';
import { CCT_SOURCE_REVISION } from './source-cct';
import { CCT_PROJECTION_REVISION } from './target-projection';
import { CONSTANT_DIRECTION_POLICY_ID, CONSTANT_DIRECTION_SOURCE_REVISION } from './source-constant-direction';
import { MACRO_MOMENTUM_POLICY_ID, SOURCE_MACRO_MOMENTUM_REVISION } from './source-macro-momentum';

export const CCT_PAPER_POLICY = Object.freeze({
  id: 'CCT_LC_B5_S6_BUFFER11_V1', strategy: 'cct-lc-b5-v1' as const,
  sourceRevision: CCT_SOURCE_REVISION, solverRevision: CCT_PROJECTION_REVISION,
  grossCap: '8', bandThreshold: '0.2', closeBufferUsd: '1.1',
  initialCash: '100', dailyLossLimitUsd: '10', leverage: '10', maintenanceRate: '0.005',
} as const);
/** Separate identity and checkpoint namespace; preserve the tested -8.9u soft threshold. */
export const CONSTANT_DIRECTION_POLICY = Object.freeze({
  id: CONSTANT_DIRECTION_POLICY_ID, strategy: 'constant-direction-b5-v1' as const,
  sourceRevision: CONSTANT_DIRECTION_SOURCE_REVISION, solverRevision: CCT_PROJECTION_REVISION,
  grossCap: '8', bandThreshold: '0.2', closeBufferUsd: '6.1',
  initialCash: '100', dailyLossLimitUsd: '15', leverage: '10', maintenanceRate: '0.005',
} as const);

/** Calibrated zero-breach macro momentum policy: $25x2=$50 exposure, 12% SL, daily loss cap 12u */
export const MACRO_MOMENTUM_CALIBRATED_POLICY = Object.freeze({
  id: MACRO_MOMENTUM_POLICY_ID, strategy: 'macro-momentum-calibrated-v1' as const,
  sourceRevision: SOURCE_MACRO_MOMENTUM_REVISION, solverRevision: CCT_PROJECTION_REVISION,
  grossCap: '0.5', bandThreshold: '0.2', closeBufferUsd: '5.9',
  initialCash: '100', dailyLossLimitUsd: '12', leverage: '10', maintenanceRate: '0.005',
} as const);

export type PortfolioPaperPolicyId = 'momentum-v1' | typeof CCT_PAPER_POLICY.id | typeof CONSTANT_DIRECTION_POLICY.id | typeof MACRO_MOMENTUM_CALIBRATED_POLICY.id;
export function normalizePortfolioPaperPolicy(value?: string): PortfolioPaperPolicyId {
  if (value === undefined || value === '' || value === 'momentum-v1') return 'momentum-v1';
  if (value === CCT_PAPER_POLICY.id || value === CCT_PAPER_POLICY.strategy) return CCT_PAPER_POLICY.id;
  if (value === CONSTANT_DIRECTION_POLICY.id || value === CONSTANT_DIRECTION_POLICY.strategy) return CONSTANT_DIRECTION_POLICY.id;
  if (value === MACRO_MOMENTUM_CALIBRATED_POLICY.id || value === MACRO_MOMENTUM_CALIBRATED_POLICY.strategy) return MACRO_MOMENTUM_CALIBRATED_POLICY.id;
  throw new Error(`Unknown portfolio paper policy: ${value}`);
}

export function buildConstantDirectionConfig(filters: Record<string, SymbolFilter>,
  costs: { feeRate?: Numeric; slippageBps?: Numeric } = {}): PortfolioPaperConfig {
  const { id, ...policy } = CONSTANT_DIRECTION_POLICY;
  return { ...policy, policyId: id, filters, feeRate: costs.feeRate ?? '0.0005', slippageBps: costs.slippageBps ?? '2' };
}
export function buildCctPaperConfig(filters: Record<string, SymbolFilter>,
  costs: { feeRate?: Numeric; slippageBps?: Numeric } = {}): PortfolioPaperConfig {
  const { id, ...policy } = CCT_PAPER_POLICY;
  return { ...policy, policyId: id, filters, feeRate: costs.feeRate ?? '0.0005', slippageBps: costs.slippageBps ?? '2' };
}
export function buildMacroMomentumCalibratedConfig(filters: Record<string, SymbolFilter>,
  costs: { feeRate?: Numeric; slippageBps?: Numeric } = {}): PortfolioPaperConfig {
  const { id, ...policy } = MACRO_MOMENTUM_CALIBRATED_POLICY;
  return { ...policy, policyId: id, filters, feeRate: costs.feeRate ?? '0.0007', slippageBps: costs.slippageBps ?? '2' };
}
