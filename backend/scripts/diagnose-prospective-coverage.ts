import 'dotenv/config';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {buildOpportunitySnapshot,buildResearchOpportunitySnapshot} from '../src/utils/ai-opportunity';
const root='../docs/audits/2026-09-12-prospective-opportunity/';
const policy={...getAiOpportunityPolicy(),mode:'shadow' as const};
const expectedHash=createHash('sha256').update(policy.hash+':btc-prospective-v1').digest('hex');
const baseline:Record<string,number>={},expanded:Record<string,number>={},reversal:Record<string,number>={};
let snapshots=0,baselinePlans=0,expandedPlans=0,missingReferencePlans=0;
for(const file of readdirSync(root).filter(f=>/^snapshot-\d+\.json$/.test(f))){
 const packet=JSON.parse(readFileSync(root+file,'utf8')),s=packet.snapshot;
 if(s.policyHash!==expectedHash)throw new Error('reconstruction_policy_changed');
 const input={asOf:s.asOf,candles:s.candles,finance:s.finance,policy};
 const b=buildOpportunitySnapshot({...input,diagnostics:baseline})!;
 const e=buildResearchOpportunitySnapshot({...input,diagnostics:expanded})!;
 const r=buildResearchOpportunitySnapshot({...input,diagnostics:reversal},'structure_reclaim')!;
 const ids=new Set([...e.plans,...r.plans].map(p=>p.id));
 if(JSON.stringify([...ids].sort())!==JSON.stringify(s.plans.map((p:any)=>p.id).sort()))throw new Error('cohort_reconstruction_mismatch');
 snapshots++;baselinePlans+=b.plans.length;expandedPlans+=ids.size;
 missingReferencePlans+=b.plans.filter(p=>!ids.has(p.id)).length;
}
const result={snapshots,baselinePlans,expandedPlans,missingReferencePlans,baseline,expanded,reversal,
 warning:'Candidate counts only, not historical AI choices or portfolio PnL.'};
writeFileSync(root+'coverage-diagnostics.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
