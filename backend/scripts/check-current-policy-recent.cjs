const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-09-current-policy-replay/recent');fs.mkdirSync(out,{recursive:true});
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
const policies=[{name:'current_base',slippage:.001},{name:'current_stress',slippage:.002}].map(p=>({...p,rr:1.5,bos:false,kind:'range_sweep_reclaim',side:'long',room:false}));
const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-entry-opportunity/historical-funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
const start=new Date('2026-03-10T00:00:00Z'),end=new Date('2026-09-06T00:00:00Z');
const approvedEnv={"MAX_EFFECTIVE_RISK_PER_TRADE_USD":"","MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT":"3","DAILY_LOSS_LIMIT_PERCENT":"10","POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES":"60","POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES":"60","CONSECUTIVE_LOSS_COOLDOWN_HOURS":"1","LOSS_COOLDOWN_TIER2_HOURS":"1","LOSS_COOLDOWN_TIER3_HOURS":"1","LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY":"false","CIRCUIT_EXPECTANCY_COOLDOWN_HOURS":"1","PENDING_ORDER_REENTRY_COOLDOWN_MINUTES":"60"};
const plan={createdAt:new Date().toISOString(),start,end,policies,approvedEnv,initialWallet:33.59964603,hypothesis:'Replay the existing BTC long-5m range RR1.5 strategy under the current user-pinned 1h/10%/3% policy. Base and stress costs on two previously examined 180-day windows. No live parameter changes.',limitations:'Historical sensitivity only; no untouched holdout, full LLM/limit-fill/latency/mark-to-market/full portfolio circuit. Candidate wait/retest timing is still approximate. Stress changes eligibility as well as costs.'};
fs.writeFileSync(out+'/plan.json',JSON.stringify(plan,null,2));
(async()=>{
 for(const p of policies){
  const file=out+'/'+p.name+'.json';if(fs.existsSync(file)){console.log('Completed result exists '+p.name);continue;}
  console.log('START '+p.name+' '+new Date().toISOString());
  Object.assign(process.env,approvedEnv);
  const risk=require(root+'/src/config/risk-policy').getRiskPolicy();if(risk.dailyLossLimitPercent!==10||risk.maxEffectiveRiskPerTradeUsd!==null||risk.maxEffectiveRiskPerTradePercent!==3||risk.lossCooldownTier2Hours!==1||risk.lossCooldownTier3Hours!==1||risk.lossCooldownTier3UntilUtcDay)throw Error('Pinned risk config mismatch');
  const result=await runAdaptiveSetupReplay({symbol:'BTC',byTf,start,end,consumeExecutionRejectedRetests:true,modelPostCloseCooldown:true,executionWalletUsd:33.59964603,fundingHistory:funding,slippageFraction:p.slippage,rangeRequireMicroBos:p.bos,rangeLong5mOnly:true,rrByKind:{[p.kind]:p.rr},candidateFilter:c=>c.kind===p.kind});
  result.admissionAudit={approvedEnv,modelPostCloseCooldown:true,consumeExecutionRejectedRetests:true};fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({policy:p.name,stats:result.byKind[p.kind],account:result.account}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
