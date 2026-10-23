/**
 * OFFLINE EVALUATION ONLY. Never imported by the live worker.
 *
 * Replays OpenRouter risk-veto shadow observations against later prices and
 * measures the counterfactual of scaling each planned leg by the model's
 * sizeMultiplier. Leg PnL is expressed in fraction-of-equity units:
 *   basePnl    = weight * (exit / entry - 1)
 *   appliedPnl = weight * sizeMultiplier * (exit / entry - 1)
 * A positive `deltaPnl` means applying the verdicts would have helped.
 * Fees, funding and slippage are ignored (reducing size only saves fees).
 */
import type { RiskVetoAction, RiskVetoObservation } from '../services/openrouter-risk-veto-shadow.service';

const DAY_MS = 86_400_000;

/** Returns a close at/after a time, or null when unknown. */
export type RiskVetoPriceLookup = (symbol: string, timeMs: number) => number | null;

export interface RiskVetoLegOutcome {
  decisionTimeMs: number; symbol: string; action: RiskVetoAction | 'missing';
  weight: number; sizeMultiplier: number; entry: number; exit: number;
  legReturn: number; basePnl: number; appliedPnl: number; deltaPnl: number;
}

export interface RiskVetoActionSummary { legs: number; basePnl: number; appliedPnl: number; deltaPnl: number }

export interface RiskVetoEvaluation {
  observations: number; validObservations: number; skippedObservations: number;
  legs: RiskVetoLegOutcome[]; skippedLegs: number;
  basePnl: number; appliedPnl: number; deltaPnl: number;
  byAction: Record<RiskVetoAction | 'missing', RiskVetoActionSummary>;
}

/**
 * Pure counterfactual evaluator. Invalid observations are skipped unless
 * `includeInvalid` is set, in which case missing verdicts count as keep (x1).
 */
export function evaluateRiskVetoShadow(
  observations: readonly RiskVetoObservation[],
  exitPrice: RiskVetoPriceLookup,
  options: { horizonMs?: number; includeInvalid?: boolean; entryPrice?: RiskVetoPriceLookup } = {},
): RiskVetoEvaluation {
  const horizonMs = options.horizonMs ?? DAY_MS;
  const empty = (): RiskVetoActionSummary => ({ legs: 0, basePnl: 0, appliedPnl: 0, deltaPnl: 0 });
  const result: RiskVetoEvaluation = {
    observations: observations.length, validObservations: 0, skippedObservations: 0,
    legs: [], skippedLegs: 0, basePnl: 0, appliedPnl: 0, deltaPnl: 0,
    byAction: { keep: empty(), reduce: empty(), veto: empty(), missing: empty() },
  };
  for (const observation of observations) {
    if (observation.valid) result.validObservations++;
    else if (!options.includeInvalid) { result.skippedObservations++; continue; }
    const start = observation.plan.executeAtMs;
    for (const leg of observation.plan.legs) {
      if (leg.weight === 0) continue;
      const verdict = observation.verdicts.find(v => v.symbol === leg.symbol);
      const entry = options.entryPrice?.(leg.symbol, start) ?? leg.price;
      const exit = exitPrice(leg.symbol, start + horizonMs);
      if (entry === null || exit === null || !(entry > 0) || !(exit > 0)) { result.skippedLegs++; continue; }
      const sizeMultiplier = verdict?.sizeMultiplier ?? 1;
      const legReturn = exit / entry - 1;
      const basePnl = leg.weight * legReturn;
      const appliedPnl = basePnl * sizeMultiplier;
      const outcome: RiskVetoLegOutcome = {
        decisionTimeMs: observation.decisionTimeMs, symbol: leg.symbol, action: verdict?.action ?? 'missing',
        weight: leg.weight, sizeMultiplier, entry, exit, legReturn, basePnl, appliedPnl, deltaPnl: appliedPnl - basePnl,
      };
      result.legs.push(outcome);
      const bucket = result.byAction[outcome.action];
      bucket.legs++; bucket.basePnl += basePnl; bucket.appliedPnl += appliedPnl; bucket.deltaPnl += outcome.deltaPnl;
      result.basePnl += basePnl; result.appliedPnl += appliedPnl; result.deltaPnl += outcome.deltaPnl;
    }
  }
  return result;
}

export function parseRiskVetoObservationsNdjson(body: string): RiskVetoObservation[] {
  return body.split(/\r?\n/).filter(line => line.trim()).flatMap(line => {
    try {
      const parsed = JSON.parse(line) as RiskVetoObservation;
      return parsed && parsed.plan && Array.isArray(parsed.plan.legs) ? [parsed] : [];
    } catch { return []; }
  });
}

/**
 * Daily close CSV: header `date,<SYMBOL>,...`, `date` as YYYY-MM-DD (UTC open
 * day). A row's close is known at openTime + 1 day, so the lookup for time T
 * returns the close of the row whose close time is the first one >= T.
 */
export function dailyCloseLookupFromCsv(body: string): RiskVetoPriceLookup {
  const lines = body.trim().split(/\r?\n/);
  const header = (lines.shift() ?? '').split(',').map(cell => cell.trim());
  const closes = new Map<string, Map<number, number>>();
  for (const symbol of header.slice(1)) closes.set(symbol, new Map());
  for (const line of lines) {
    const cells = line.split(',');
    const openTimeMs = Date.parse(`${cells[0]?.trim()}T00:00:00.000Z`);
    if (!Number.isFinite(openTimeMs)) continue;
    header.slice(1).forEach((symbol, i) => {
      const value = Number(cells[i + 1]);
      if (cells[i + 1]?.trim() && Number.isFinite(value) && value > 0) closes.get(symbol)!.set(openTimeMs + DAY_MS, value);
    });
  }
  return (symbol, timeMs) => closes.get(symbol)?.get(Math.ceil(timeMs / DAY_MS) * DAY_MS) ?? null;
}
