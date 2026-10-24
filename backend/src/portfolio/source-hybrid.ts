import type { DailyPriceRow, SourcePortfolioTargets } from './types';
import { SOURCE_UNIVERSE } from './source-momentum';

export const SOURCE_HYBRID_REVISION = 'phase2-hybrid-mom50-btcgrid45-sl12-v1';
export const HYBRID_POLICY_ID = 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1';
const DAY = 86_400_000;

export interface HybridSleeve1Metadata {
  selectedSymbols: string[];
  allocPerCoin: number;
  grossExposure: number;
  rebalanceDays: number;
  stopLossPct: number;
  scores: Record<string, number>;
}

export interface HybridSleeve2Metadata {
  btcPrice: number;
  btcEma10: number;
  btc1dReturn: number;
  crashGateTripped: boolean;
  activeLevels: number;
  targetWeight: number;
  ticketPerLevel: number;
  maxLevels: number;
  stepPct: number;
  takeProfitPct: number;
}

export interface Phase2HybridTargetMetadata {
  sleeve1: HybridSleeve1Metadata;
  sleeve2: HybridSleeve2Metadata;
  totalGrossExposure: number;
  signalCountChanged: boolean;
}

/**
 * Builds Phase 2 Multi-Sleeve Hybrid Targets:
 * - Sleeve 1 (Core Trend): Top 2 Altcoins ranked by 14-day momentum (> +2%), 0.25 ($25) each = $50 total.
 * - Sleeve 2 (BTC Mean-Reversion Grid): Dip below 10-day EMA (-2%, -4%, -6%), $15/level up to 3 levels ($45 max).
 *   Protected by a 6% 1-day BTC Crash Gate freezing entries during market-wide collapses.
 * - Shared 100u wallet, strictly <= 12.0 USDT daily loss ceiling.
 */
export function buildPhase2HybridTargets(
  rows: DailyPriceRow[],
  executeAtMs: number,
  options: {
    momAllocPerCoin?: number;
    momTopN?: number;
    momLookbackDays?: number;
    momMinScore?: number;
    gridTicketPerLevel?: number;
    gridMaxLevels?: number;
    gridStepPct?: number;
    gridTakeProfitPct?: number;
    btcCrashGatePct?: number;
    currentGridLevels?: number;
  } = {}
): SourcePortfolioTargets {
  if (!Number.isSafeInteger(executeAtMs) || executeAtMs % DAY !== 0) {
    throw new Error('Source execution must be an exact UTC midnight');
  }

  const momAlloc = options.momAllocPerCoin ?? 0.25; // $25 on $100
  const momTopN = options.momTopN ?? 2;
  const momLookback = options.momLookbackDays ?? 14;
  const momMinScore = options.momMinScore ?? 0.02;

  const gridTicket = options.gridTicketPerLevel ?? 0.15; // $15 on $100
  const gridMaxLevels = options.gridMaxLevels ?? 3;
  const gridStepPct = options.gridStepPct ?? 0.02;
  const gridTakeProfitPct = options.gridTakeProfitPct ?? 0.03;
  const btcCrashGatePct = options.btcCrashGatePct ?? 0.06;

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
  const pastRow = byTime.get(latestLabel - momLookback * DAY);
  const yesterdayRow = byTime.get(latestLabel - DAY);

  // ---------------------------------------------------------------------------
  // Sleeve 1: Macro Momentum Top 2
  // ---------------------------------------------------------------------------
  const momScores: { symbol: string; score: number }[] = [];
  const scoreMap: Record<string, number> = {};

  if (todayRow && pastRow) {
    for (const sym of SOURCE_UNIVERSE) {
      const todayPrice = todayRow.closes[sym];
      const pastPrice = pastRow.closes[sym];
      if (
        todayPrice != null &&
        pastPrice != null &&
        Number.isFinite(todayPrice) &&
        Number.isFinite(pastPrice) &&
        pastPrice > 0 &&
        todayPrice > 0
      ) {
        const score = (todayPrice - pastPrice) / pastPrice;
        scoreMap[sym] = score;
        if (score >= momMinScore) {
          momScores.push({ symbol: sym, score });
        }
      }
    }
  }

  momScores.sort((a, b) => b.score - a.score);
  const selectedMom = momScores.slice(0, momTopN).map((item) => item.symbol);

  // ---------------------------------------------------------------------------
  // Sleeve 2: BTC Mean-Reversion Grid Maker with Crash Gate
  // ---------------------------------------------------------------------------
  let btcTodayPrice = 0;
  let btcYesterdayPrice = 0;
  let btc1dReturn = 0;
  let crashGateTripped = false;
  let gridLevels = 0;
  let btcEma10 = 0;

  if (todayRow && todayRow.closes['BTCUSDT']) {
    btcTodayPrice = todayRow.closes['BTCUSDT']!;
    if (yesterdayRow && yesterdayRow.closes['BTCUSDT']) {
      btcYesterdayPrice = yesterdayRow.closes['BTCUSDT']!;
      btc1dReturn = (btcTodayPrice - btcYesterdayPrice) / btcYesterdayPrice;
    }

    if (btc1dReturn < -btcCrashGatePct) {
      crashGateTripped = true;
    }

    // Compute 10-day EMA / average of BTC
    const btcWindow: number[] = [];
    for (let t = latestLabel - 9 * DAY; t <= latestLabel; t += DAY) {
      const p = byTime.get(t)?.closes['BTCUSDT'];
      if (p != null && Number.isFinite(p) && p > 0) {
        btcWindow.push(p);
      }
    }

    if (btcWindow.length >= 8) {
      btcEma10 = btcWindow.reduce((sum, v) => sum + v, 0) / btcWindow.length;
      if (!crashGateTripped && btcTodayPrice > 0 && btcEma10 > 0) {
        // Calculate dip levels
        for (let lvl = 1; lvl <= gridMaxLevels; lvl++) {
          const dipPrice = btcEma10 * (1.0 - lvl * gridStepPct);
          if (btcTodayPrice <= dipPrice) {
            gridLevels = lvl;
          }
        }
      }
    }
  }

  // Combine target weights across both sleeves
  const weights: Record<string, number> = {};
  const decimalWeights: Record<string, string> = {};

  for (const sym of SOURCE_UNIVERSE) {
    weights[sym] = 0;
    decimalWeights[sym] = '0';
  }

  // Assign Sleeve 1 momentum weights
  for (const sym of selectedMom) {
    weights[sym] = momAlloc;
    decimalWeights[sym] = momAlloc.toString();
  }

  // Assign Sleeve 2 BTC grid weight (if BTC is already in momentum, take max)
  const btcGridWeight = gridLevels * gridTicket;
  if (btcGridWeight > 0) {
    const combinedBtc = Math.min(0.45, (weights['BTCUSDT'] || 0) + btcGridWeight);
    weights['BTCUSDT'] = combinedBtc;
    decimalWeights['BTCUSDT'] = combinedBtc.toString();
  }

  const sleeve1Meta: HybridSleeve1Metadata = {
    selectedSymbols: selectedMom,
    allocPerCoin: momAlloc,
    grossExposure: selectedMom.length * momAlloc,
    rebalanceDays: 2,
    stopLossPct: 0.12,
    scores: scoreMap,
  };

  const sleeve2Meta: HybridSleeve2Metadata = {
    btcPrice: btcTodayPrice,
    btcEma10,
    btc1dReturn,
    crashGateTripped,
    activeLevels: gridLevels,
    targetWeight: btcGridWeight,
    ticketPerLevel: gridTicket,
    maxLevels: gridMaxLevels,
    stepPct: gridStepPct,
    takeProfitPct: gridTakeProfitPct,
  };

  const totalGross = Object.values(weights).reduce((a, b) => a + b, 0);

  const metadata: Record<string, { signalCountChanged: boolean; [key: string]: unknown }> = {
    _hybrid: {
      signalCountChanged: false,
      sleeve1: sleeve1Meta,
      sleeve2: sleeve2Meta,
      totalGrossExposure: totalGross,
    },
  };

  for (const sym of SOURCE_UNIVERSE) {
    metadata[sym] = {
      signalCountChanged: false,
      weight: weights[sym],
      isMomentumSelected: selectedMom.includes(sym),
      isBtcGrid: sym === 'BTCUSDT' && gridLevels > 0,
    };
  }

  return {
    weights,
    decimalWeights,
    knownAtMs: labelTimeMs,
    executeAtMs,
    labelTimeMs,
    sourceId: `${SOURCE_HYBRID_REVISION}:${executeAtMs}:${selectedMom.join('-')}:btc_lvl${gridLevels}`,
    strategy: 'multi-sleeve-hybrid-v1',
    policyId: HYBRID_POLICY_ID,
    sourceRevision: SOURCE_HYBRID_REVISION,
    metadata,
  };
}
