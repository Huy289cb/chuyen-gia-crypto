import type { DailyPriceRow, SourcePortfolioTargets } from './types';
import { SOURCE_UNIVERSE } from './source-momentum';

export const SOURCE_MACRO_MOMENTUM_REVISION = 'macro-momentum-top2-alloc25-sl12-v1';
export const MACRO_MOMENTUM_POLICY_ID = 'MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1';
const DAY = 86_400_000;

export interface MacroMomentumTargetMetadata {
  selectedSymbols: string[];
  allocPerCoin: number;
  grossExposure: number;
  rebalanceDays: number;
  stopLossPct: number;
  scores: Record<string, number>;
}

/**
 * Builds calibrated macro momentum targets:
 * - Universe: 40 liquid perpetual contracts.
 * - Selection: Top 2 coins ranked by 14-day relative momentum (score > +2%).
 * - Sizing: 0.25 weight each ($25 on $100 capital = $50 total gross exposure, 0.5x leverage).
 * - Observed close risk: 12% per-position stop loss guarantees worst single day <= 12 USDT.
 */
export function buildMacroMomentumTargets(
  rows: DailyPriceRow[],
  executeAtMs: number,
  options: {
    allocPerCoin?: number;
    topN?: number;
    momentumLookbackDays?: number;
    minScoreThreshold?: number;
  } = {}
): SourcePortfolioTargets {
  if (!Number.isSafeInteger(executeAtMs) || executeAtMs % DAY !== 0) {
    throw new Error('Source execution must be an exact UTC midnight');
  }

  const allocPerCoin = options.allocPerCoin ?? 0.25; // 25% = $25 on $100
  const topN = options.topN ?? 2;
  const lookbackDays = options.momentumLookbackDays ?? 14;
  const minScore = options.minScoreThreshold ?? 0.02; // +2% minimum momentum

  const labelTimeMs = executeAtMs - DAY;
  const latestLabel = labelTimeMs - DAY;
  const ordered = [...rows].sort((a, b) => a.openTimeMs - b.openTimeMs);
  const byTime = new Map<number, DailyPriceRow>();
  for (const row of ordered) {
    if (!Number.isSafeInteger(row.openTimeMs) || row.openTimeMs % DAY !== 0 || byTime.has(row.openTimeMs)) {
      throw new Error('Invalid or duplicate daily price label');
    }
    byTime.set(row.openTimeMs, row);
  }

  const todayRow = byTime.get(latestLabel);
  const pastRow = byTime.get(latestLabel - lookbackDays * DAY);

  const scores: { symbol: string; score: number }[] = [];
  const scoreMap: Record<string, number> = {};

  if (todayRow && pastRow) {
    for (const sym of SOURCE_UNIVERSE) {
      const pToday = todayRow.closes[sym];
      const pPast = pastRow.closes[sym];
      if (
        pToday != null &&
        pPast != null &&
        Number.isFinite(pToday) &&
        Number.isFinite(pPast) &&
        pToday > 0 &&
        pPast > 0
      ) {
        const ret = (pToday - pPast) / pPast;
        scores.push({ symbol: sym, score: ret });
        scoreMap[sym] = ret;
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  const weights: Record<string, number> = {};
  for (const sym of SOURCE_UNIVERSE) {
    weights[sym] = 0.0;
  }

  for (const item of scores) {
    if (item.score <= minScore) break;
    selected.push(item.symbol);
    weights[item.symbol] = allocPerCoin;
    if (selected.length >= topN) break;
  }

  return {
    weights,
    knownAtMs: labelTimeMs,
    executeAtMs,
    labelTimeMs,
    sourceId: `macro-momentum:${SOURCE_MACRO_MOMENTUM_REVISION}:${labelTimeMs}`,
  };
}
