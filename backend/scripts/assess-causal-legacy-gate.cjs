'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const runtime=path.join(root,'docs/audits/2026-10-04-causal-workflow-runtime/runtime');
const {analyzeSetupGate}=require(path.join(runtime,'analyzers/setup-gate.analyzer.js'));
const data=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/2026-09-11-opportunity-testbed/train-data.json')));
(async()=>{
 const rows=[];
 for(const mechanism of ['H1','H2']){
  const inventory=JSON.parse(fs.readFileSync(path.join(root,`docs/audits/2026-10-04-${mechanism.toLowerCase()}-feasibility/inventory.json`)));
  const tf=mechanism==='H1'?'15m':'5m',duration=mechanism==='H1'?900000:300000;
  for(const row of inventory.filter(x=>x.window&&x.status==='plan')){
   const candles=data.byTf[tf].filter(b=>b[0]+duration+5000<=row.resolvedAt).slice(-100).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));
   const result=await analyzeSetupGate({candles,symbol:'BTC',timeframe:tf});
   rows.push({mechanism,setup_id:row.candidate.id,at:row.resolvedAt,side:row.candidate.side,grade:result.grade,confidence:result.confidence,playbook:result.playbookKey,regime:result.regime,evidence:result.evidence});
  }
 }
 if(rows.length!==67)throw Error(`inventory mismatch ${rows.length}`);
 const counts={};for(const row of rows){const k=`${row.mechanism}:${row.grade}:${row.playbook??'none'}`;counts[k]=(counts[k]??0)+1;}
 const out={scope:'offline frozen legacy analyzer; not scheduler cached gate, reviewer, fills or economic measurement',plan_count:rows.length,counts,rows};
 fs.writeFileSync(path.join(root,'docs/audits/2026-10-04-causal-gate-compatibility/assessment.json'),JSON.stringify(out,null,2));
 console.log(JSON.stringify({plan_count:rows.length,counts}));
})().catch(e=>{console.error(e);process.exitCode=1;});
