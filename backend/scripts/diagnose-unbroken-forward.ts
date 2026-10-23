import 'dotenv/config';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {buildResearchOpportunitySnapshot} from '../src/utils/ai-opportunity';
const root='../docs/audits/2026-09-12-prospective-opportunity/';
const policy={...getAiOpportunityPolicy(),mode:'shadow' as const};
const expected=createHash('sha256').update(policy.hash+':btc-prospective-v1').digest('hex');
const diagnostics:Record<string,number>={},rows=[];
for(const file of readdirSync(root).filter(f=>/^snapshot-\d+\.json$/.test(f)).sort()){
 const s=JSON.parse(readFileSync(root+file,'utf8')).snapshot;
 if(s.policyHash!==expected)throw new Error('policy_mismatch');
 const candidate=buildResearchOpportunitySnapshot({asOf:s.asOf,candles:s.candles,finance:s.finance,policy,diagnostics},'unbroken_targets');
 if(!candidate)throw new Error('invalid_snapshot');
 if(candidate.plans.length)rows.push({snapshot:file,asOf:s.asOf,plans:candidate.plans});
}
const result={scope:'Post-hoc reconstruction on captured market data; not frozen prospective choices, not AI outcomes and not ROI evidence.',diagnostics,snapshotsWithPlans:rows.length,rows};
writeFileSync(root+'unbroken-targets-posthoc-diagnostics.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({diagnostics,snapshotsWithPlans:rows.length},null,2));
