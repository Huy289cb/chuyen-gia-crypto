// Fixed historical entry-stream interaction check, NOT a regenerated combined strategy backtest.
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const {ReplayAccount}=require(root+'/src/backtest/replay-account');
const {getRiskPolicy}=require(root+'/src/config/risk-policy');
const policy=getRiskPolicy(), dir=path.resolve(root,'../docs/audits'), out=dir+'/2026-09-07-btc-range-promotion';
const read=p=>JSON.parse(fs.readFileSync(dir+'/'+p));
const core=['2026-09-07-entry-risk-1usd-validation','2026-09-07-entry-risk-1usd'].flatMap(d=>read(d+'/baseline-wallet.json').result.trades)
 .map((t,i)=>({...t,key:'core-'+i,kind:'core'}));
const candleMap=new Map();
for(const d of ['2026-09-07-entry-opportunity','2026-09-07-entry-risk-1usd-validation']) {
 for(const f of fs.readdirSync(dir+'/'+d).filter(n=>n.startsWith('candles-')&&n.endsWith('.json'))) {
  for(const row of read(d+'/'+f).byTf['5m'])candleMap.set(row.timestamp,row);
 }
}
const candles=[...candleMap.values()].sort((a,b)=>a.timestamp-b.timestamp);
const funding=read('2026-09-07-entry-opportunity/historical-funding.json').rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
function simulate(rows,slip) {
 const a=new ReplayAccount({initialWallet:34.27714639,maxRiskUsd:1,maxRiskPercent:2,targetRiskPercent:.5,maxExposureUsd:100,dailyLossPercent:3,feePerSide:.0005,slippageFraction:slip,funding});
 const entries=[...rows].sort((a,b)=>a.entryTime-b.entryTime||(a.kind==='range'?-1:1));
 let index=0,held=null,peak=a.wallet,maxDd=0;const closed=[],blocks={};
 function mark(price) {const eq=a.wallet+(held?(held.side==='long'?1:-1)*(price-held.entryPrice)*held.quantity:0);peak=Math.max(peak,eq);maxDd=Math.max(maxDd,(peak-eq)/peak*100);return eq;}
 function close(time) {if(held && held.closeTime<=time){const financial=a.close(held.key,held.closePrice,held.closeTime);closed.push({...held,financial});held=null;mark(0);}}
 for(const bar of candles) {
  const time=bar.timestamp+300000;
  while(index<entries.length && entries[index].entryTime<=time) {
   const t=entries[index++];close(t.entryTime);a.advance(t.entryTime);
   const equity=mark(t.entryPrice),recent=closed.slice(-policy.circuitExpectancyWindow);
   let reason=null;
   if(policy.circuitDrawdownEnabled && (peak-equity)/peak*100>=policy.maxDrawdownPercent)reason='drawdown';
   if(policy.circuitExpectancyKillEnabled && recent.length>=policy.circuitExpectancyWindow && recent.reduce((s,t)=>s+t.financial.netR,0)<=policy.circuitExpectancyMinSumR)reason='expectancy';
   if(reason){blocks[reason]=(blocks[reason]??0)+1;continue;}
   const admission=a.tryOpen({key:t.key,side:t.side,entry:t.entryPrice,stopLoss:t.stopLoss,time:t.entryTime});
   if(admission.accepted)held={...t,quantity:admission.quantity};
  }
  close(time);a.advance(time);mark(bar.close);
 }
 if(held)throw Error('Unclosed fixed stream position');
 return {trades:closed.length,byKind:closed.reduce((o,t)=>(o[t.kind]=(o[t.kind]??0)+1,o),{}),netUsd:a.wallet-a.options.initialWallet,maxDrawdownCloseMarkedPercent:maxDd,blocks:{...a.blocks,...blocks},closed};
}
const cases={core};
for(const [name,file] of [['baseline','2026-09-07-btc-retest-financial/range_baseline.json'],['rejection_rr15','2026-09-07-btc-retest-financial/range_rejection_rr15.json'],['rr2_inside','2026-09-07-btc-target-room/range_rr2_inside.json'],['inside','2026-09-07-btc-range-promotion/baseline_inside.json']]) {
 if(!fs.existsSync(dir+'/'+file))continue;
 const r=read(file).outcomes.map((t,i)=>({...t,key:'range-'+i,kind:'range',entryTime:t.confirmedAt,closeTime:t.closedAt}));
 cases['core_plus_'+name]=[...core,...r];
}
const results={};
for(const [name,rows] of Object.entries(cases))for(const slip of [.001,.002])results[name+'_'+slip]=simulate(rows,slip);
fs.writeFileSync(out+'/portfolio-interaction.json',JSON.stringify({createdAt:new Date().toISOString(),limitations:['Fixed entry streams from separate research runs; does not regenerate candidates suppressed during another strategy position.','One wallet, one position, entry fees/slippage, actual funding, daily budget, loss cooldown and last-N expectancy circuit. Drawdown sampled at 5m closes; excludes intrabar peaks, LLM veto and execution latency.','Stress reuses entry streams for interaction checks; native strategy stress results are separate.'],results},null,2));
for(const [name,r] of Object.entries(results)){const {closed,...summary}=r;console.log(JSON.stringify({name,...summary}));}
