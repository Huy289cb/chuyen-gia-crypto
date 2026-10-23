const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),base=root+'/docs/audits/2026-09-24-live-testbed',audit=root+'/docs/audits/2026-09-25-trend-research',read=p=>JSON.parse(fs.readFileSync(p));
const original=read(base+'/protocol.json'),protocol=read(audit+'/protocol.json');const dataset=process.argv[2];let marketFile=base+'/market.json';let out=audit;if(dataset){const d=read(root+'/docs/audits/2026-09-21-core-ablation/protocol.json').datasets.find(d=>d.id===dataset);if(!d)throw Error('unknown dataset');marketFile=d.file;protocol.developmentStart=Date.parse(d.start);protocol.developmentEnd=Date.parse(d.end);protocol.split=Math.floor((protocol.developmentStart+protocol.developmentEnd)/2/60000)*60000;out=audit+'/'+dataset;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/dataset.json',JSON.stringify(d,null,2));}
for(const k of Object.keys(process.env))if(/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_)/.test(k))delete process.env[k];Object.assign(process.env,original.policyEnv);
const {replayCoreCandidates}=require('../src/backtest/live-range-execution-replay.ts'),{getRiskPolicy}=require('../src/config/risk-policy.ts'),{getAiOpportunityPolicy}=require('../src/config/ai-opportunity-policy.ts');
const risk=getRiskPolicy(),policy={...getAiOpportunityPolicy(),minRr:0,ttlMs:2700000},circuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,expectancyMinSumR:risk.circuitExpectancyMinSumR,maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};

const crypto=require('crypto'),{generate}=require('./trend-research-signals.cjs');
if(crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'trend-research-signals.cjs'))).digest('hex')!==protocol.generatorSha256)throw Error('generator changed');
const market=read(marketFile),signals=generate(market.byTf,protocol.developmentStart,protocol.developmentEnd);fs.writeFileSync(out+'/signals.json',JSON.stringify(signals));
const checks=[];
for(const variant of protocol.variants){
 const xs=signals[variant];
 for(const c of xs){if(c.sourceClose>=c.time||c.htfClose>=c.time||Math.abs(c.entry-c.stopLoss)/c.entry<.008-1e-9)throw Error('causality or floor');}
 for(const c of xs.filter((_,i)=>i%Math.max(1,Math.floor(xs.length/10))===0)){
  const durations={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
  const truncated=Object.fromEntries(Object.entries(market.byTf).filter(([tf])=>['15m','1h','4h'].includes(tf)).map(([tf,b])=>[tf,b.filter(x=>x[0]+durations[tf]<=c.sourceClose)]));
  const regenerated=generate(truncated,protocol.developmentStart,protocol.developmentEnd)[variant].find(x=>x.id===c.id);
  if(JSON.stringify(c)!==JSON.stringify(regenerated))throw Error('prefix invariance failed');checks.push(c.id);
 }
}
fs.writeFileSync(out+'/causality.json',JSON.stringify({prefixChecks:checks.length,signals:Object.fromEntries(Object.entries(signals).map(([k,v])=>[k,v.length]))}));
const rows=[];
for(const [period,start,end]of [['first',protocol.developmentStart,protocol.split],['second',protocol.split,protocol.developmentEnd],['full',protocol.developmentStart,protocol.developmentEnd]])for(const variant of protocol.variants)for(const slippage of [.001,.002]){
 const candidates=signals[variant].filter(c=>c.time>=start&&c.time<end);
 const r=replayCoreCandidates({bars:market.byTf['1m'],funding:market.funding,candidates,start,end,wallet:original.wallet,policy,circuit,slippage,runtimeProfitProtect:'fixed_buffer'});
 const row={period,variant,cost:slippage===.001?'base':'stress',...r.summary};rows.push(row);fs.writeFileSync(out+`/${period}-${variant}-${row.cost}.json`,JSON.stringify(r));fs.writeFileSync(out+'/summary.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
}
const qualified=protocol.variants.filter(v=>['first','second'].every(p=>{const r=rows.find(r=>r.period===p&&r.variant===v&&r.cost==='stress');return r.netUsd>0&&r.profitFactor>=1.1&&r.fills>=10&&r.maxDrawdownPercent<=15;}));
fs.writeFileSync(out+'/selection.json',JSON.stringify({qualified,reservedWindowOpened:false,liveChanged:false},null,2));
