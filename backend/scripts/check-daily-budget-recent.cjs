const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-08-daily-budget-study/recent');fs.mkdirSync(out,{recursive:true});
const candleUtils=require(root+'/src/backtest/candle-loader');
const byTf={};
for(const directory of ['2026-09-07-entry-opportunity','2026-09-07-entry-risk-1usd-validation']){
 const dir=path.resolve(root,'../docs/audits/'+directory);
 for(const file of fs.readdirSync(dir).filter(n=>n.startsWith('candles-')&&n.endsWith('.json'))){
  const data=JSON.parse(fs.readFileSync(path.join(dir,file)));
  for(const [tf,rows] of Object.entries(data.byTf)){
   const map=byTf[tf]??=new Map();
   for(const row of rows){const prior=map.get(row.timestamp);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw Error('Conflicting candles '+tf);map.set(row.timestamp,row);}
  }
 }
}
for(const tf of Object.keys(byTf)){
 byTf[tf]=[...byTf[tf].values()].sort((a,b)=>a.timestamp-b.timestamp);
 for(let i=1;i<byTf[tf].length;i++)if(byTf[tf][i].timestamp-byTf[tf][i-1].timestamp!==candleUtils.timeframeDurationMs(tf))throw Error('Candle gap '+tf);
}
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
const policies=[{name:'daily5_base',rr:1.5,bos:false,slippage:.001},{name:'daily5_stress',rr:1.5,bos:false,slippage:.002}].map(p=>({...p,kind:'range_sweep_reclaim',side:'long',room:false}));
const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-entry-opportunity/historical-funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
const start=new Date('2026-03-10T00:00:00Z'),end=new Date('2026-09-06T00:00:00Z');
const plan={createdAt:new Date().toISOString(),start,end,policies,hypothesis:'Change only the daily planned-loss budget from 3% to 5%, fixed 1 USD total risk cap per trade, on the already deployed long-5m range RR1.5 policy. Consume execution-rejected candidates. Compare against completed daily3% runs on the same two periods. Do not modify live configuration from a single window.',fixed:{dailyLossPercent:5,riskCapUsd:1,consumeExecutionRejectedRetests:true,rangeLong5mOnly:true,rangeEdgeFraction:.3,minSlPct:.008,feePerSide:.0005},limitations:'Historical policy sensitivity; previously examined data, not an untouched future holdout. No full LLM, fill/latency or regenerated core+range portfolio; risk/cooldown guards modeled as in the baseline. Higher daily loss budget is a distinct risk tradeoff.'};
fs.writeFileSync(out+'/plan.json',JSON.stringify(plan,null,2));
(async()=>{
 for(const p of policies){
  const file=out+'/'+p.name+'.json';if(fs.existsSync(file)){console.log('Completed result exists '+p.name);continue;}
  console.log('START '+p.name+' '+new Date().toISOString());
  process.env.DAILY_LOSS_LIMIT_PERCENT='5';
  const result=await runAdaptiveSetupReplay({symbol:'BTC',byTf,start,end,consumeExecutionRejectedRetests:true,executionWalletUsd:34.27714639,fundingHistory:funding,slippageFraction:p.slippage,rangeRequireMicroBos:p.bos,rangeLong5mOnly:true,rrByKind:{[p.kind]:p.rr},candidateFilter:c=>c.kind===p.kind});
  fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({policy:p.name,stats:result.byKind[p.kind],account:result.account}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
