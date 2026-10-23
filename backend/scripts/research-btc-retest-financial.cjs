const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-07-btc-retest-financial');fs.mkdirSync(out,{recursive:true});
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
analyzer.analyzeSetupGate=async input=>{
 const key=input.timeframe+':'+input.candles[0]?.timestamp+':'+input.candles.at(-1)?.timestamp+':'+input.candles.length;
 if(cache.has(key))return cache.get(key);
 const value=await analyze(input);
 cache.set(key,value.grade==='A'||value.grade==='B'?value:{grade:'D'});return value;
};
const {runAdaptiveSetupReplay}=require(root+'/src/backtest/adaptive-setup-replay');
const policies=[{name:'range_baseline',rr:1.5,bos:true,kind:'range_sweep_reclaim'},{name:'range_rejection_rr15',rr:1.5,bos:false,kind:'range_sweep_reclaim'},{name:'range_rejection_rr2',rr:2,bos:false,kind:'range_sweep_reclaim'},{name:'micro_rr3',rr:3,bos:true,kind:'aligned_micro_bos'}];
const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-entry-opportunity/historical-funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
const start=new Date('2026-03-10T00:00:00Z'),end=new Date('2026-09-06T00:00:00Z');
const plan={createdAt:new Date().toISOString(),start,end,policies,hypothesis:'Compare baseline range against removal of only the second retest BOS (1.5R and 2R); separately test aligned micro-BOS at 3R rather than deployed shadow 2R. Regenerate candidates with financial admission, single position, actual fee legs, funding cashflows, daily budget and risk cap 1 USD.',fixed:{rangeLong5mOnly:true,rangeEdgeFraction:.3,minSlPct:.008,feePerSide:.0005,riskCapUsd:1,slippageFraction:.001},limitations:'Historical screen, not unseen out-of-sample. Candidate fills require financial admission and separate confirmation before live promotion.'};
fs.writeFileSync(out+'/plan.json',JSON.stringify(plan,null,2));
(async()=>{
 for(const p of policies){
  const file=out+'/'+p.name+'.json';if(fs.existsSync(file)){console.log('Completed result exists '+p.name);continue;}
  console.log('START '+p.name+' '+new Date().toISOString());
  const result=await runAdaptiveSetupReplay({symbol:'BTC',byTf,start,end,executionWalletUsd:34.27714639,fundingHistory:funding,slippageFraction:.001,rangeRequireMicroBos:p.bos,rangeLong5mOnly:true,rrByKind:{[p.kind]:p.rr},candidateFilter:c=>c.kind===p.kind});
  fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({policy:p.name,stats:result.byKind[p.kind],account:result.account}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
