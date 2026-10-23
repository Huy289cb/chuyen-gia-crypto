const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-08-post-close-parity/prior');fs.mkdirSync(out,{recursive:true});
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
const policies=[3,5].flatMap(daily=>[{name:'daily'+daily+'_base',slippage:.001},{name:'daily'+daily+'_stress',slippage:.002}].map(p=>({...p,daily,rr:1.5,bos:false,kind:'range_sweep_reclaim',side:'long',room:false})));
const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-btc-target-room-prior/funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
const start=new Date('2025-09-11T00:00:00Z'),end=new Date('2026-03-10T00:00:00Z');
const plan={createdAt:new Date().toISOString(),start,end,policies,hypothesis:'Model existing live post-close cooldown (90m win/360m loss) before comparing daily planned-loss budgets 3% and 5%, fixed 1 USD total risk cap per trade, on the already deployed long-5m range RR1.5 policy. Consume execution-rejected candidates. Compare against completed daily3% runs on the same two periods. Do not modify live configuration from a single window.',fixed:{dailyLossPercent:[3,5],postCloseWinMinutes:90,postCloseLossMinutes:360,riskCapUsd:1,consumeExecutionRejectedRetests:true,rangeLong5mOnly:true,rangeEdgeFraction:.3,minSlPct:.008,feePerSide:.0005},limitations:'Historical policy sensitivity; previously examined data, not an untouched future holdout. No full LLM, fill/latency or regenerated core+range portfolio; risk/cooldown guards modeled as in the baseline. Higher daily loss budget is a distinct risk tradeoff.'};
fs.writeFileSync(out+'/plan.json',JSON.stringify(plan,null,2));
(async()=>{
 for(const p of policies){
  const file=out+'/'+p.name+'.json';if(fs.existsSync(file)){console.log('Completed result exists '+p.name);continue;}
  console.log('START '+p.name+' '+new Date().toISOString());
  process.env.DAILY_LOSS_LIMIT_PERCENT=String(p.daily);process.env.POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES='90';process.env.POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES='360';
  const risk=require(root+'/src/config/risk-policy').getRiskPolicy();if(risk.dailyLossLimitPercent!==p.daily||risk.maxEffectiveRiskPerTradeUsd!==1)throw Error('Risk config mismatch');
  const result=await runAdaptiveSetupReplay({symbol:'BTC',byTf,start,end,consumeExecutionRejectedRetests:true,modelPostCloseCooldown:true,requireRangeTargetRoom:p.room,executionWalletUsd:34.27714639,fundingHistory:funding,slippageFraction:p.slippage,rangeRequireMicroBos:p.bos,rangeLong5mOnly:false,rrByKind:{[p.kind]:p.rr},candidateFilter:c=>c.kind===p.kind&&c.timeframe==='5m'&&(p.side==='both'||c.side===p.side)});
  result.admissionAudit={dailyLossPercent:p.daily,riskCapUsd:1,postCloseWinMinutes:90,postCloseLossMinutes:360,modelPostCloseCooldown:true,consumeExecutionRejectedRetests:true};fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({policy:p.name,stats:result.byKind[p.kind],account:result.account}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
