/** Research gate only: a pass never sends an order or changes a live policy. */
export interface ResearchTrade {
  waveId: string; closedAt: number; grossUsd: number;
  feeUsd: number; fundingUsd: number; slippageUsd: number; aiCostUsd: number | null;
}
export interface ResearchRun {
  from: number; through: number;
  initialEquity: number; finalEquity: number; deposits: number; withdrawals: number;
  openEquityChange: number; unallocatedAiCostUsd: number | null;
  maxDrawdownFraction: number; trades: ResearchTrade[];
}
export interface ResearchComparison { baseline: ResearchRun; candidate: ResearchRun }
export interface ResearchEvidence {
  evaluatedAt: number; sourceHash: string; protocolHash: string;
  independent: boolean; prospectiveWeeks: number; executionParity: boolean;
  multiplicityAdjusted: boolean; lower95AddedExpectancyUsd: number; lower95DeltaPnlUsd: number;
  base: ResearchComparison; stress: ResearchComparison;
}
export interface ResearchFreeze {
  frozenAt: number; sourceHash: string; protocolHash: string;
  hypothesis: string; supportingEvidence: string[];
  policy: { symbol: 'BTC'; cooldownMinutes: 60; dailyPercent: 10; maxRiskPercent: 3; targetPercent: 0.5; maxRiskUsd: null };
}
export function netResearchTrade(t: ResearchTrade): number | null {
  if (!t.waveId || !Number.isFinite(t.closedAt) ||
    ![t.grossUsd, t.feeUsd, t.fundingUsd, t.slippageUsd, t.aiCostUsd].every(x => typeof x === 'number' && Number.isFinite(x)) ||
    t.feeUsd < 0 || t.slippageUsd < 0 || t.aiCostUsd! < 0) return null;
  // Funding is signed: a credit is negative cost.
  return t.grossUsd - t.feeUsd - t.fundingUsd - t.slippageUsd - t.aiCostUsd!;
}
function inspectRun(r: ResearchRun) {
  const values = r.trades.map(netResearchTrade);
  const known = values.every(x => x !== null) && typeof r.unallocatedAiCostUsd === 'number' &&
    Number.isFinite(r.unallocatedAiCostUsd) && r.unallocatedAiCostUsd >= 0;
  const finite = [r.from, r.through, r.initialEquity, r.finalEquity, r.deposits, r.withdrawals, r.openEquityChange, r.maxDrawdownFraction].every(Number.isFinite);
  const pnl = r.finalEquity - r.initialEquity - r.deposits + r.withdrawals;
  const netClosed = known ? (values as number[]).reduce((a,b) => a+b,0) - r.unallocatedAiCostUsd! : null;
  const unique = new Set(r.trades.map(t => t.waveId)).size === r.trades.length;
  const gain = (values as (number|null)[]).reduce<number>((a,b) => a + Math.max(b ?? 0, 0),0);
  const loss = (values as (number|null)[]).reduce<number>((a,b) => a + Math.max(-(b ?? 0), 0),0) + (r.unallocatedAiCostUsd ?? 0);
  const chronological = r.through > r.from && r.trades.every((t,i) => t.closedAt >= r.from && t.closedAt <= r.through &&
    (i === 0 || t.closedAt >= r.trades[i-1].closedAt));
  return { valid: known && finite && unique && chronological && r.initialEquity > 0 && r.finalEquity >= 0 &&
    r.deposits >= 0 && r.withdrawals >= 0 && r.maxDrawdownFraction >= 0 && r.maxDrawdownFraction <= 1 &&
    Math.abs(pnl - netClosed! - r.openEquityChange) < 1e-6,
    pnl, roi: pnl / r.initialEquity, profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0,
    knownCosts: known, uniqueWaves: unique };
}
export function evaluateResearchPromotion(f: ResearchFreeze, e: ResearchEvidence) {
  const failures: string[] = [];
  if (!f.hypothesis?.trim() || !f.supportingEvidence?.length) failures.push('unsupported_hypothesis');
  if (!f.policy || f.policy.symbol !== 'BTC' || f.policy.cooldownMinutes !== 60 || f.policy.dailyPercent !== 10 ||
    f.policy.maxRiskPercent !== 3 || f.policy.targetPercent !== .5 || f.policy.maxRiskUsd !== null) failures.push('owner_policy');
  if (!Number.isFinite(f.frozenAt) || !Number.isFinite(e.evaluatedAt) || e.evaluatedAt <= f.frozenAt ||
    !f.sourceHash || !f.protocolHash || f.sourceHash !== e.sourceHash || f.protocolHash !== e.protocolHash) failures.push('freeze_mismatch');
  if (!e.independent) failures.push('not_independent');
  if (!e.executionParity) failures.push('execution_parity_unproven');
  if (!Number.isFinite(e.prospectiveWeeks) || e.prospectiveWeeks < 8) failures.push('prospective_sample');
  if (!e.multiplicityAdjusted || !Number.isFinite(e.lower95AddedExpectancyUsd) || e.lower95AddedExpectancyUsd <= 0 ||
    !Number.isFinite(e.lower95DeltaPnlUsd) || e.lower95DeltaPnlUsd <= 0) failures.push('statistical_evidence');
  const scenarios = Object.fromEntries((['base','stress'] as const).map(cost => {
    const pair = e[cost], b = inspectRun(pair.baseline), c = inspectRun(pair.candidate);
    if (!b.valid || !c.valid) failures.push(`${cost}:ledger_or_costs_invalid`);
    if (pair.baseline.from !== pair.candidate.from || pair.baseline.through !== pair.candidate.through ||
      pair.candidate.from !== e.base.candidate.from || pair.candidate.through !== e.base.candidate.through ||
      pair.candidate.through > e.evaluatedAt) failures.push(`${cost}:window_mismatch`);
    if (pair.baseline.initialEquity !== pair.candidate.initialEquity ||
      pair.baseline.deposits !== pair.candidate.deposits || pair.baseline.withdrawals !== pair.candidate.withdrawals)
      failures.push(`${cost}:unequal_capital`);
    const baselineWaves = new Set(pair.baseline.trades.map(t => t.waveId));
    const added = pair.candidate.trades.filter(t => !baselineWaves.has(t.waveId));
    const addedKnown = added.every(t => netResearchTrade(t) !== null) && c.knownCosts;
    // Conservatively charge all candidate unallocated inference costs to the added cohort.
    const addedNet = addedKnown ? added.reduce((a,t) => a + netResearchTrade(t)!,0) - pair.candidate.unallocatedAiCostUsd! : null;
    if (!(c.pnl > 0 && c.roi > 0 && c.pnl - b.pnl > 0 && addedNet !== null && addedNet > 0 && added.length > 0))
      failures.push(`${cost}:nonpositive_roi_or_added_edge`);
    if (!(cost === 'base' ? c.profitFactor >= 1.2 : c.profitFactor > 1)) failures.push(`${cost}:profit_factor`);
    if (pair.candidate.maxDrawdownFraction > .15 || pair.candidate.maxDrawdownFraction > pair.baseline.maxDrawdownFraction)
      failures.push(`${cost}:drawdown`);
    if (pair.candidate.trades.length < 100) failures.push(`${cost}:oos_trade_count`);
    if (pair.baseline.trades.length < 10 ? added.length < 10 : pair.candidate.trades.length < Math.ceil(pair.baseline.trades.length * 1.2))
      failures.push(`${cost}:insufficient_added_trades`);
    return [cost, { baseline: b, candidate: c, addedTrades: added.length, addedNetUsd: addedNet,
      addedExpectancyUsd: addedNet !== null && added.length ? addedNet / added.length : null, deltaPnlUsd: c.pnl-b.pnl }];
  }));
  return { researchPass: failures.length === 0, deploymentAuthorized: false, failures, scenarios,
    limitations: ['Statistical intervals and independence/parity attestations require separately reviewed evidence.',
      'Base/stress are alternate paths, never pooled as independent trades.'] };
}
