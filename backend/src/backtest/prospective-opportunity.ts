import {classifyStructureBias} from '../utils/structure-bias';
import {createHash} from 'node:crypto';
import {buildOpportunitySnapshot,buildResearchOpportunitySnapshot,type OpportunityBuildInput,type OpportunitySnapshot} from '../utils/ai-opportunity';

export const PROSPECTIVE_COHORT_VERSION='btc-prospective-v1';
export const PROSPECTIVE_UNION_VERSION='btc-prospective-v2-union';
/** Paired opportunity-selection study; financial inputs are PAPER assumptions, not account authorization. */
export function buildProspectiveCohort(input:OpportunityBuildInput,version:typeof PROSPECTIVE_COHORT_VERSION|typeof PROSPECTIVE_UNION_VERSION=PROSPECTIVE_COHORT_VERSION){
 const baseline=buildOpportunitySnapshot(input);
 const expanded=buildResearchOpportunitySnapshot(input);
 const reversal=buildResearchOpportunitySnapshot(input,'structure_reclaim');
 if(!baseline||!expanded||!reversal)return null;
 // Keep v1 reproducible. In v2, preserve baseline plans verbatim when execution IDs overlap.
 const pools=version===PROSPECTIVE_UNION_VERSION?[expanded,reversal,baseline]:[expanded,reversal];
 const plans=[...new Map(pools.flatMap(s=>s.plans).map(p=>[p.id,p])).values()]
  .sort((a,b)=>a.riskUsd-b.riskUsd||a.setup.localeCompare(b.setup)||a.id.localeCompare(b.id));
 const evidence=[...new Map(pools.flatMap(s=>s.evidence).map(e=>[e.id,e])).values()];
 const snapshot:OpportunitySnapshot={...expanded,version,plans,evidence,
  policyHash:createHash('sha256').update(input.policy.hash+':'+version).digest('hex'),
  deterministicPlanId:plans[0]?.id??null};
 return {snapshot,referenceCurrentLibrary:baseline,legacyBotDecision:null,
  financialContext:'fixed-paper-wallet; no live account/cooldown authorization',
  evaluation:'Record every plan including rejected/unselected plans; paired outcomes must occur after asOf. Counterfactual sum is not portfolio ROI.'};
}

/** TRAIN hypothesis: preserve v2 opportunities only in directional H4 regimes. */
export function buildDirectionalRegimeCohort(input:OpportunityBuildInput){
 const cohort=buildProspectiveCohort(input,PROSPECTIVE_UNION_VERSION);
 if(!cohort)return null;
 const version='btc-research-directional-regime-v1';
 const bias=classifyStructureBias(input.candles['4h'],{strength:2}).bias;
 const plans=bias==='transition'?[]:cohort.snapshot.plans;
 return {...cohort,snapshot:{...cohort.snapshot,version,plans,
  policyHash:createHash('sha256').update(input.policy.hash+':'+version).digest('hex'),
  deterministicPlanId:plans[0]?.id??null}};
}
