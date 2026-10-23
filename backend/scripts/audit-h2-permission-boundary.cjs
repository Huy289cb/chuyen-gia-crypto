'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/audits/2026-10-07-h2-permission-boundary');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
Object.assign(process.env,read('docs/audits/2026-10-04-continuous-causal-portfolio/policy.json').environment);
const frozen=path.join(root,'docs/audits/2026-10-04-causal-workflow-runtime/runtime');
const {analyzeSetupGate}=require(path.join(frozen,'analyzers/setup-gate.analyzer.js'));
const {validateOptimizedRangeRetest}=require(path.join(frozen,'utils/adaptive-retest-dispatch.js'));
const {classifyStructureBias}=require(path.join(frozen,'utils/structure-bias.js'));
const data=read('docs/audits/2026-09-11-opportunity-testbed/train-data.json');
const quality=read('docs/audits/2026-10-07-causal-quality/measurement.json');
const rows=[];
function bars(tf,d,at,n){return data.byTf[tf].filter(b=>b[0]+d+5000<=at).slice(-n).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));}
(async()=>{
 for(const row of read('docs/audits/2026-10-04-h2-feasibility/inventory.json').filter(r=>r.window&&r.status==='plan')){
  const c=row.candidate,p=row.plan,q=quality.rows.find(x=>x.setup_id===c.id);
  const setup=await analyzeSetupGate({symbol:'BTC',timeframe:'5m',candles:bars('5m',300000,c.knownAt,100)});
  const hour=await analyzeSetupGate({symbol:'BTC',timeframe:'1h',candles:bars('1h',3600000,row.resolvedAt,100)});
  const structure=classifyStructureBias(bars('4h',14400000,row.resolvedAt,120),{strength:2});
  const context={candidateKey:c.id,candidateKind:'range_sweep_reclaim',side:c.side,boundaryPrice:c.side==='long'?c.low:c.high,breakoutBarKey:String(c.knownAt-305000),confirmedEntryPrice:p.entry,minRr:1.5,rangeLow:c.low,rangeHigh:c.high};
  const exception=validateOptimizedRangeRetest({context,timeframe:'5m',signalResult:{setupResult:setup},htf1h:{fresh:true,regime:hour.regime},structureBias:structure.bias});
  const rr=Math.abs(p.target-p.entry)/Math.abs(p.entry-p.stop);
  rows.push({setup_id:c.id,known_at:c.knownAt,resolved_at:row.resolvedAt,side:c.side,
    actual_legacy_at_sweep:{grade:setup.grade,confidence:setup.confidence,playbook:setup.playbookKey,regime:setup.regime,evidence:setup.evidence},
    frozen_causal_quality:{grade:q.grade,score:q.rule_quality,generic_signal_pass:q.signal_pass,generic_pre_ai:q.pre_ai},
    actual_htf_regime:hour.regime,actual_structure:structure,existing_exception:exception,rr,rr_pass:rr>=1.5,financial_raw_cap5_pass:row.financial.cap5_pass,
    would_satisfy_existing_exception_and_frozen_quality:exception.pass&&q.grade==='A'&&q.rule_quality>=.7&&rr>=1.5&&row.financial.cap5_pass});
 }
 if(rows.length!==56)throw Error('expected_56');
 const files=['backend/src/utils/adaptive-retest-dispatch.ts','backend/src/services/groq-dispatch.service.ts','docs/plan/2026-10-02-roi-upgrade-plan.md','docs/audits/2026-10-07-h2-permission-boundary/registration.md'];
 const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
 const result={scope:'read-only existing exception applicability; not actual workflow permission or economic evidence',provider_calls:0,rows,hashes,
  exception_pass:rows.filter(r=>r.existing_exception.pass).length,intersection:rows.filter(r=>r.would_satisfy_existing_exception_and_frozen_quality).map(r=>r.setup_id)};
 fs.writeFileSync(path.join(out,'assessment.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({exception_pass:result.exception_pass,intersection:result.intersection}));
})().catch(e=>{console.error(e);process.exitCode=1;});
