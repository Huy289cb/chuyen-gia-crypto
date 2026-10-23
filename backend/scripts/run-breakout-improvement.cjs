const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),base=root+'/docs/audits/2026-09-24-live-testbed',audit=root+'/docs/audits/2026-09-25-breakout-improvement',read=p=>JSON.parse(fs.readFileSync(p));
const original=read(base+'/protocol.json'),protocol=read(audit+'/protocol.json');const dataset=process.argv[2];let marketFile=base+'/market.json';let out=audit;if(dataset){const d=read(root+'/docs/audits/2026-09-21-core-ablation/protocol.json').datasets.find(d=>d.id===dataset);if(!d)throw Error('unknown dataset');marketFile=d.file;protocol.developmentStart=Date.parse(d.start);protocol.developmentEnd=Date.parse(d.end);protocol.split=Math.floor((protocol.developmentStart+protocol.developmentEnd)/2/60000)*60000;out=audit+'/'+dataset;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/dataset.json',JSON.stringify(d,null,2));}
for(const k of Object.keys(process.env))if(/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_)/.test(k))delete process.env[k];Object.assign(process.env,original.policyEnv);
const {replayCoreCandidates}=require('../src/backtest/live-range-execution-replay.ts'),{getRiskPolicy}=require('../src/config/risk-policy.ts'),{getAiOpportunityPolicy}=require('../src/config/ai-opportunity-policy.ts');
const risk=getRiskPolicy(),policy={...getAiOpportunityPolicy(),minRr:0,ttlMs:2700000},circuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,expectancyMinSumR:risk.circuitExpectancyMinSumR,maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};


const prior=root+'/docs/audits/2026-09-25-trend-research'+(dataset?'/'+dataset:''),{strongClose}=require('./breakout-improvement-filter.cjs');
const market=read(marketFile),baseline=read(prior+'/signals.json').compression_breakout,filtered=strongClose(baseline,market.byTf['15m']);
const rows=[];const periods=dataset?[['full',protocol.developmentStart,protocol.developmentEnd]]:[['full',protocol.developmentStart,protocol.developmentEnd],['first',protocol.developmentStart,protocol.split],['second',protocol.split,protocol.developmentEnd]];
for(const [period,start,end]of periods)for(const variant of protocol.variants)for(const slippage of [.001,.002]){
 const candidates=(variant==='strong_close'||variant==='combined'?filtered:baseline).filter(c=>c.time>=start&&c.time<end);
 const r=replayCoreCandidates({bars:market.byTf['1m'],funding:market.funding,candidates,start,end,wallet:original.wallet,policy,circuit,slippage,runtimeProfitProtect:'fixed_buffer',exitPolicy:variant==='cost_protection'||variant==='combined'?'cost_protection_1r':undefined});
 const cost=slippage===.001?'base':'stress';
 if(variant==='baseline'){const old=read(prior+`/${period}-compression_breakout-${cost}.json`);if(JSON.stringify(old)!==JSON.stringify(r))throw Error('baseline parity failed');}
 const row={period,variant,cost,...r.summary};rows.push(row);fs.writeFileSync(out+`/${period}-${variant}-${cost}.json`,JSON.stringify(r));fs.writeFileSync(out+'/summary.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
}
fs.writeFileSync(out+'/inventory.json',JSON.stringify({baseline:baseline.length,strongClose:filtered.length,ids:filtered.map(c=>c.id)}));
