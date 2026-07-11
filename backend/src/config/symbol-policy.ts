import { getRiskPolicy } from './risk-policy';
import { resolveMaxTotalExposureUsd } from './v3-entry-policy';

export type SignalGrade = 'A' | 'B' | 'C' | 'D';

export interface SymbolPolicy {
  symbol: string;
  maxExposureUsd: number;
  minSlDistancePercent: number;
  minSignalGrade: SignalGrade;
  minSignalConfidence: number;
  riskMultiplier: number;
  allowedPlaybooks: string[];
}

const VALID_GRADES = new Set<SignalGrade>(['A', 'B', 'C', 'D']);

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, '');
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseConfidence(raw: string | undefined, fallback: number): number {
  const n = parseNumber(raw, fallback);
  return Math.max(0, Math.min(1, n));
}

function parseGrade(raw: string | undefined, fallback: SignalGrade): SignalGrade {
  const grade = raw?.trim().toUpperCase() as SignalGrade | undefined;
  return grade && VALID_GRADES.has(grade) ? grade : fallback;
}

function envFor(symbol: string, key: string): string | undefined {
  return process.env[`SYMBOL_POLICY_${normalizeSymbol(symbol)}_${key}`];
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getEnabledSymbols(): string[] {
  const raw = (process.env.ENABLED_SYMBOLS || 'BTC')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean);
  return raw.length > 0 ? Array.from(new Set(raw)) : ['BTC'];
}

export function getSymbolPolicy(symbol: string): SymbolPolicy {
  const base = getRiskPolicy();
  const normalized = normalizeSymbol(symbol);
  const maxExposureRaw = envFor(normalized, 'MAX_EXPOSURE_USD');
  const fallbackMax = base.maxTotalExposureUsd;

  return {
    symbol: normalized,
    maxExposureUsd: parseNumber(maxExposureRaw, fallbackMax),
    minSlDistancePercent: parseNumber(
      envFor(normalized, 'MIN_SL_DISTANCE_PERCENT'),
      base.minSlDistancePercent
    ),
    minSignalGrade: parseGrade(envFor(normalized, 'MIN_SIGNAL_GRADE'), base.minSignalGrade),
    minSignalConfidence: parseConfidence(
      envFor(normalized, 'MIN_SIGNAL_CONFIDENCE'),
      base.minSignalConfidence
    ),
    riskMultiplier: parseNumber(envFor(normalized, 'RISK_MULTIPLIER'), 1),
    allowedPlaybooks: parseCsv(envFor(normalized, 'ALLOWED_PLAYBOOKS')),
  };
}

export function getSymbolMaxExposureUsd(symbol: string, walletBalance: number): number {
  const normalized = normalizeSymbol(symbol);
  const explicit = envFor(normalized, 'MAX_EXPOSURE_USD');
  if (explicit?.trim()) {
    return getSymbolPolicy(normalized).maxExposureUsd;
  }

  return resolveMaxTotalExposureUsd(walletBalance, getSymbolPolicy(normalized).maxExposureUsd);
}

export function getCorrelationMaxExposureUsd(side: 'long' | 'short'): number | null {
  const key = side === 'long'
    ? 'CORRELATION_MAX_LONG_EXPOSURE_USD'
    : 'CORRELATION_MAX_SHORT_EXPOSURE_USD';
  const raw = process.env[key];
  if (!raw?.trim()) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
