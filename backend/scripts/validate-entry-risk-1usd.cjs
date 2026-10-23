// Read-only research: no exchange credentials, order clients, or production mutations.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for (const key of Object.keys(process.env)) if (/KEY|SECRET|DATABASE_URL|DIRECT_URL|TOKEN|PASSWORD/.test(key)) delete process.env[key];
process.env.BINANCE_ENABLED='false';
process.env.MAX_EFFECTIVE_RISK_PER_TRADE_USD='1';
const out = path.resolve(root,'../docs/audits/2026-09-07-entry-risk-1usd-validation');
fs.mkdirSync(out,{recursive:true});
const loader = require(root+'/dist-risk-1usd/backtest/candle-loader');
const load = loader.loadBacktestCandles, cache = new Map();
loader.loadBacktestCandles = async options => {
  const key=JSON.stringify(options), digest=crypto.createHash('sha256').update(key).digest('hex').slice(0,16);
  if (!cache.has(key)) {
    const file=out+'/candles-'+digest+'.json';
    let loaded;
    if(fs.existsSync(file)){ loaded=JSON.parse(fs.readFileSync(file)); loaded.period.start=new Date(loaded.period.start); loaded.period.end=new Date(loaded.period.end); }
    else {loaded=await load(options); fs.writeFileSync(file,JSON.stringify(loaded));}
    for(const [tf, rows] of Object.entries(loaded.byTf)) {
      const duration=loader.timeframeDurationMs(tf);
      for(let i=1;i<rows.length;i++) if(rows[i].timestamp-rows[i-1].timestamp!==duration) throw Error('Gap or duplicate '+tf);
      if(!rows.length) throw Error('No candles '+tf);
    }
    cache.set(key,loaded);
  }
  return cache.get(key);
};
const variants=require(root+'/dist-risk-1usd/config/testbed-variants').TESTBED_VARIANTS;
const definitions={
  baseline: {id:'baseline',label:'Current policy',enableCooldown:true},
  'entry-pb050':{id:'entry-pb050',label:'Only pullback 0.50%',enableCooldown:true,pullbackMaxAbovePct:0.5,breakoutPullbackMaxAbovePct:0.5},
  'entry-directional':{id:'entry-directional',label:'Directional structure retained; additional BOS disabled',enableCooldown:true,structureShortRequireBos:false,structureLongRequireBos:false},
  'entry-directional-pb050':{id:'entry-directional-pb050',label:'Directional structure + pullback 0.50%',enableCooldown:true,structureShortRequireBos:false,structureLongRequireBos:false,pullbackMaxAbovePct:0.5,breakoutPullbackMaxAbovePct:0.5}
};
Object.assign(variants,definitions);
const {runHistoricalTestbed}=require(root+'/dist-risk-1usd/backtest/historical-testbed.service');
const manifest={createdAt:new Date().toISOString(),end:'2026-07-08T00:00:00Z',days:120,maxRiskUsd:1,wallet:34.27714639,feePctPerSide:0.0005,slippagePct:0.001,variants:definitions,limitations:['Earlier chronological validation with two frozen policies selected before running this window. Not a prospective/live trial; cannot certify that the historical period was never used by earlier project research.','Funding excluded in initial screen; modeled SL/TP, not full live execution.','No policy promotion based solely on this screen.']};
fs.writeFileSync(out+'/screen-plan.json',JSON.stringify(manifest,null,2));
(async()=>{
 for(const variant of ['baseline','entry-pb050']){
  const file=out+'/'+variant+'-wallet.json';
  if(fs.existsSync(file)){console.log('Existing completed result '+variant);continue;}
  console.log('START '+variant+' '+new Date().toISOString());
  const result=await runHistoricalTestbed({symbol:'BTC',days:manifest.days,endDate:new Date(manifest.end),notionalUsd:100,executionWalletUsd:manifest.wallet,feePctPerSide:manifest.feePctPerSide,slippagePct:manifest.slippagePct,variant});
  const wins=result.trades.filter(t=>t.pnlUsd>0).reduce((s,t)=>s+t.pnlUsd,0),loss=-result.trades.filter(t=>t.pnlUsd<0).reduce((s,t)=>s+t.pnlUsd,0);
  let eq=0,peak=0,dd=0;for(const t of result.trades){eq+=t.pnlUsd;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  const summary={trades:result.trades.length,net: eq,profitFactor:loss?wins/loss:null,maxDrawdown:dd,executionBlocks:result.blocks.execution_risk,forcedEndCloses:result.trades.filter(t=>t.closeReason==='end_of_data').length};
  fs.writeFileSync(file,JSON.stringify({summary,result},null,2));console.log(JSON.stringify({variant,summary}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
