const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-08-admission-sensitivity/prior');fs.mkdirSync(out,{recursive:true});
const byTf=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-btc-target-room-prior/candles.json'))).byTf;
// Reuse only deterministic setup analysis on identical candle windows across policies.
// Most calls are grade D; store one sentinel for those to fit the small production VPS.
const analyzer=require(root+'/src/analyzers/setup-gate.analyzer'), analyze=analyzer.analyzeSetupGate, cache=new Map();
const cachedAnalyze=async input=>{
 const key=input.timeframe+':'+input.candles[0]?.timestamp+':'+input.candles.at(-1)?.timestamp+':'+input.candles.length;
 if(cache.has(key))return cache.get(key);
 const value=await analyze(input);
 cache.set(key,value.grade==='A'||value.grade==='B'?value:{grade:'D'});return value;
};
require.cache[require.resolve(root+'/src/analyzers/setup-gate.analyzer')].exports={...analyzer,analyzeSetupGate:cachedAnalyze};
if(require(root+'/src/analyzers/setup-gate.analyzer').analyzeSetupGate!==cachedAnalyze)throw Error('Analysis cache installation failed');
const {runAdaptiveSetupReplay}=require(root+'/src/backtest/adaptive-setup-replay');
const policies=[{name:'consume_base',rr:1.5,bos:false,slippage:.001},{name:'consume_stress',rr:1.5,bos:false,slippage:.002}].map(p=>({...p,kind:'range_sweep_reclaim',side:'long',room:false}));
const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-btc-target-room-prior/funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
const start=new Date('2025-09-11T00:00:00Z'),end=new Date('2026-03-10T00:00:00Z');
const plan={createdAt:new Date().toISOString(),start,end,policies,hypothesis:'Frozen deployed long-5m range RR1.5, no extra retest micro BOS. Consume a confirmed candidate on executor execution_risk/daily_budget rejection instead of reattempting later retest prices. Compare to prior retry-mode results; no parameter optimization.',fixed:{consumeExecutionRejectedRetests:true,rangeLong5mOnly:true,rangeEdgeFraction:.3,minSlPct:.008,feePerSide:.0005,riskCapUsd:1},limitations:'Admission sensitivity only; no full LLM, limit fill/latency or regenerated core+range portfolio. Account cooldown/open-position queueing still approximate. Historical data previously examined.'};
fs.writeFileSync(out+'/plan.json',JSON.stringify(plan,null,2));
(async()=>{
 for(const p of policies){
  const file=out+'/'+p.name+'.json';if(fs.existsSync(file)){console.log('Completed result exists '+p.name);continue;}
  console.log('START '+p.name+' '+new Date().toISOString());
  const result=await runAdaptiveSetupReplay({symbol:'BTC',byTf,start,end,consumeExecutionRejectedRetests:true,requireRangeTargetRoom:p.room,executionWalletUsd:34.27714639,fundingHistory:funding,slippageFraction:p.slippage,rangeRequireMicroBos:p.bos,rangeLong5mOnly:false,rrByKind:{[p.kind]:p.rr},candidateFilter:c=>c.kind===p.kind&&c.timeframe==='5m'&&(p.side==='both'||c.side===p.side)});
  fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({policy:p.name,stats:result.byKind[p.kind],account:result.account}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
