// Offline development experiment. Only review stage contacts OpenRouter; no order/DB imports.
require('dotenv').config({quiet:true});
process.env.NODE_ENV='test';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {getAiOpportunityPolicy}=require('../src/config/ai-opportunity-policy');
const {getRiskPolicy}=require('../src/config/risk-policy');
const {buildOpportunitySnapshot,parseOpportunityChoice,AI_OPPORTUNITY_PROMPT}=require('../src/utils/ai-opportunity');
const {replayCoreCandidates}=require('../src/backtest/live-range-execution-replay');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/audits/2026-09-26-opportunity-rr2-ai');
const dataRoot=path.join(root,'docs/audits/2026-09-11-opportunity-testbed');
fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p)),save=(name,x)=>fs.writeFileSync(path.join(out,name),JSON.stringify(x,null,2));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const models=['qwen/qwen3-30b-a3b-instruct-2507','google/gemini-3.5-flash-lite'];
const wallet=33.59964603;
const system=AI_OPPORTUNITY_PROMPT+' Evaluate net expectancy after 0.10% round-trip fees and 0.20% slippage. Plan RR is 2; do not require RR3. Select a plan only when confirmation and target room support it.';
async function main(){
 const stage=process.argv[2];
 if(!['prepare','review','replay'].includes(stage))throw Error('stage_required');
 if(stage==='prepare'){
  if(fs.existsSync(path.join(out,'protocol.json')))throw Error('already_frozen');
  const raw=fs.readFileSync(path.join(dataRoot,'train-data.json')),manifest=read(path.join(dataRoot,'train-data-manifest.json'));
  if(sha(raw)!==manifest.sha256)throw Error('data_hash');
  const data=JSON.parse(raw),base=getAiOpportunityPolicy();if(!base.pinned)throw Error('risk_contract');
  const policies=Object.fromEntries([2,3].map(rr=>[rr,{...base,minRr:rr,hash:sha(base.hash+':rr'+rr)}]));
  const steps={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000},pointers=Object.fromEntries(Object.keys(steps).map(k=>[k,0]));
  const candles=Object.fromEntries(Object.keys(steps).map(tf=>[tf,data.byTf[tf].map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const cases=[],baseline=[];let fi=-1;
  for(const bar of candles['15m']){
   const asOf=bar.timestamp+900000,context={};
   for(const [tf,step]of Object.entries(steps)){while(pointers[tf]<candles[tf].length&&candles[tf][pointers[tf]].timestamp+step<=asOf)pointers[tf]++;context[tf]=candles[tf].slice(Math.max(0,pointers[tf]-120),pointers[tf]);}
   if(Object.values(context).some(v=>v.length<100)||asOf>=manifest.end_exclusive-48*3600000)continue;
   while(fi+1<data.funding.length&&data.funding[fi+1].time<=asOf)fi++;
   if(fi<0)continue;
   const finance={balance:wallet,remainingDailyRiskUsd:wallet*.1,remainingExposureUsd:base.maxExposure,allowed:true,stepSize:.001,minQty:.001,minNotional:50,fundingRate:data.funding[fi].rate};
   const s3=buildOpportunitySnapshot({asOf,candles:context,finance,policy:policies[3]});
   const s2=buildOpportunitySnapshot({asOf,candles:context,finance,policy:policies[2]});
   if(s3?.plans.length)baseline.push(s3);
   if(s2?.plans.length)cases.push({...s2,baselineSetups:s3.plans.map(p=>p.setup+':'+p.side)});
  }
  save('cases.json',cases);save('baseline.json',baseline);
  save('protocol.json',{createdAt:new Date().toISOString(),models,wallet,policy:base,risk:getRiskPolicy(),datasetHash:manifest.sha256,casesHash:sha(JSON.stringify(cases)),system,systemHash:sha(system),baselineHash:sha(JSON.stringify(baseline)),start:cases[0]?.asOf,end:manifest.end_exclusive,cases:cases.length,baselineCases:baseline.length,acceptance:'Positive net after all model calls in base/stress, more fills than paired RR3 and positive additional-setup net; then separate-period validation. Development screen only, never automatic live promotion.',limits:'Jan-Jun2025 previously examined; static initial-wallet plan inventory; no historical AI memory; historical LLM knowledge leakage remains possible; external AI wallet costs subtracted economically, not from exchange collateral. Common 1m replay; fixed SL/TP, no 48h exit in this bridge.'});
  console.log(JSON.stringify({cases:cases.length,baselineCases:baseline.length}));return;
 }
 const protocol=read(path.join(out,'protocol.json')),cases=read(path.join(out,'cases.json')),baseline=read(path.join(out,'baseline.json'));
 if(sha(JSON.stringify(cases))!==protocol.casesHash||sha(JSON.stringify(baseline))!==protocol.baselineHash||sha(system)!==protocol.systemHash)throw Error('frozen_input_changed');
 const responsesFile=path.join(out,'responses.json'),responses=fs.existsSync(responsesFile)?read(responsesFile):[];
 if(stage==='review'){
  const key=process.env.OPENROUTER_API_KEY;if(!key)throw Error('missing_key');
  for(const model of models)for(const snapshot of cases){
   if(responses.some(r=>r.model===model&&r.asOf===snapshot.asOf))continue;
   const {baselineSetups,...packet}=snapshot;const started=Date.now();let content=null,usage=null,error=null,choice=null;
   try{const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0,max_tokens:700,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(packet)}]})});
    if(!r.ok)throw Error('http_'+r.status);const body=await r.json();usage=body.usage??null;content=body.choices?.[0]?.message?.content??null;choice=typeof content==='string'?parseOpportunityChoice(content,snapshot):null;
   }catch(e){error=e.name==='TimeoutError'?'timeout':String(e.message).slice(0,60);}
   responses.push({model,asOf:snapshot.asOf,latencyMs:Date.now()-started,choice,content,usage,error});save('responses.json',responses);
   console.log(JSON.stringify({model,done:responses.filter(r=>r.model===model).length,total:cases.length,decision:choice?.decision,error}));
  }return;
 }
 const raw=fs.readFileSync(path.join(dataRoot,'train-data.json'));if(sha(raw)!==protocol.datasetHash)throw Error('dataset_changed');const data=JSON.parse(raw);
 const risk=protocol.risk,circuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,expectancyMinSumR:risk.circuitExpectancyMinSumR,maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};
 const summaries=[];
 for(const model of ['rules_rr3','rules_rr2',...models]){
  const answers=responses.filter(r=>r.model===model);if(models.includes(model)&&answers.length!==cases.length)throw Error('incomplete_model');
  const selected=(model==='rules_rr3'?baseline:cases).flatMap(s=>{const answer=answers.find(r=>r.asOf===s.asOf);const p=model.startsWith('rules_')?s.plans[0]:answer?.choice?.decision==='take'?s.plans.find(p=>p.id===answer.choice.plan_id):null;
   return p?[{...p,time:s.asOf+60000,timeframe:'15m',id:p.id}]:[];});
  const known=answers.every(r=>typeof r.usage?.cost==='number'&&Number.isFinite(r.usage.cost)&&r.usage.cost>=0),aiCost=known?answers.reduce((s,r)=>s+r.usage.cost,0):null;
  for(const slippage of [.001,.002]){
   const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:selected,start:protocol.start,end:protocol.end,wallet:protocol.wallet,policy:{...protocol.policy,minRr:model==='rules_rr3'?3:2},circuit,slippage});
   const extra=new Set(cases.flatMap(s=>s.plans.filter(p=>!s.baselineSetups.includes(p.setup+':'+p.side)).map(p=>p.id))),additional=result.closes.filter(c=>extra.has(c.planId));
   const cost=slippage===.001?'base':'stress';summaries.push({model,cost,...result.summary,aiCost,netAfterAi:aiCost===null?null:result.summary.netUsd-aiCost,roiAfterAi:aiCost===null?null:(result.summary.netUsd-aiCost)/protocol.wallet*100,additionalTrades:additional.length,additionalTradingNet:additional.reduce((s,c)=>s+c.netUsd,0)});save(model.replaceAll('/','__')+'-'+cost+'.json',result);
  }
 }
 save('summary.json',summaries);console.log(JSON.stringify(summaries,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
