import { expect, it } from 'vitest';
import { evaluateResearchPromotion, type ResearchEvidence, type ResearchFreeze, type ResearchRun } from '../../src/backtest/research-promotion';
const freeze: ResearchFreeze = {frozenAt:1,sourceHash:'a',protocolHash:'b',hypothesis:'fixture only',supportingEvidence:['fixture'],
  policy:{symbol:'BTC',cooldownMinutes:60,dailyPercent:10,maxRiskPercent:3,targetPercent:.5,maxRiskUsd:null}};
function run(n: number): ResearchRun {
  return { from:100, through:200, initialEquity:100, finalEquity:100+n*.7, deposits:0,withdrawals:0,openEquityChange:0,
    unallocatedAiCostUsd:0,maxDrawdownFraction:.02,
    trades:Array.from({length:n},(_,i)=>({waveId:String(i),closedAt:i+100,grossUsd:1,feeUsd:.1,fundingUsd:.1,slippageUsd:.1,aiCostUsd:0})) };
}
function evidence(): ResearchEvidence {
  return {evaluatedAt:201,sourceHash:'a',protocolHash:'b',independent:true,prospectiveWeeks:8,executionParity:true,
    multiplicityAdjusted:true,lower95AddedExpectancyUsd:.1,lower95DeltaPnlUsd:1,
    base:{baseline:run(80),candidate:run(100)},stress:{baseline:run(80),candidate:run(100)}};
}
it('passes complete synthetic evidence but never authorizes deployment',()=>{
  const r=evaluateResearchPromotion(freeze,evidence());expect(r.failures).toEqual([]);expect(r.researchPass).toBe(true);expect(r.deploymentAuthorized).toBe(false);
});
it('rejects stress losses and an added cohort hidden by profitable baseline trades',()=>{
  const e=evidence();
  for(const t of e.stress.candidate.trades.slice(80))t.grossUsd=-1;
  e.stress.candidate.finalEquity-=40;
  expect(evaluateResearchPromotion(freeze,e).failures).toContain('stress:nonpositive_roi_or_added_edge');
});
it('does not silently zero unknown inference costs or tolerate incorrect equity accounting',()=>{
  const e=evidence();e.base.candidate.trades[0].aiCostUsd=null;
  e.stress.candidate.finalEquity+=1;
  const r=evaluateResearchPromotion(freeze,e);
  expect(r.failures).toContain('base:ledger_or_costs_invalid');expect(r.failures).toContain('stress:ledger_or_costs_invalid');
});
it('rejects changed rules, duplicated waves and insufficient independent samples',()=>{
  const e=evidence();e.sourceHash='changed';e.base.candidate.trades[1].waveId='0';e.independent=false;e.prospectiveWeeks=1;
  const r=evaluateResearchPromotion(freeze,e);
  expect(r.failures).toEqual(expect.arrayContaining(['freeze_mismatch','base:ledger_or_costs_invalid','not_independent','prospective_sample']));
});
