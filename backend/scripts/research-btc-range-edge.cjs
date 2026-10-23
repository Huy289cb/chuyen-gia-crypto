const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-07-btc-range-edge');fs.mkdirSync(out,{recursive:true});
const candleUtils=require(root+'/dist/backtest/candle-loader');
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
const {ReplayAccount}=require(root+'/src/backtest/replay-account');
const {detectRangeEdgeRejection,rangeEdgeLevels}=require(root+'/src/utils/range-edge-rejection');
const {computeRegimeEvidence}=require(root+'/src/analyzers/market-regime.analyzer');
const {classifyStructureBias}=require(root+'/src/utils/structure-bias');
const {getRiskPolicy}=require(root+'/src/config/risk-policy');
const policy=getRiskPolicy();
const start=Date.parse('2026-03-10T00:00:00Z'),end=Date.parse('2026-09-06T00:00:00Z'),split=Date.parse('2026-07-08T00:00:00Z');
const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-entry-opportunity/historical-funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
const account=new ReplayAccount({initialWallet:34.27714639,maxRiskUsd:1,maxRiskPercent:2,targetRiskPercent:policy.riskPerTradePercent,maxExposureUsd:100,dailyLossPercent:policy.dailyLossLimitPercent,feePerSide:.0005,slippageFraction:.001,funding});
const plan={createdAt:new Date().toISOString(),start,end,split,hypothesis:'New setup distinct from sweep: reject an established 24h range edge without requiring a new extreme. Closed 1h range, at least 2 touches of each edge, directional 5m rejection, macro structure not opposed. Next-bar open entry; target opposite inner 20% edge; structural stop plus 0.8% minimum; reject RR<1.5. Risk 1 USD including costs, max hold 12h, one position. One fixed specification, no parameter sweep.',limits:'Standalone historical prototype, not live or combined core portfolio. OHLC intrabar exits/funding timing approximate; conservative stop-first if both hit; no LLM/fill queue/latency model.'};
fs.writeFileSync(out+'/plan.json',JSON.stringify(plan,null,2));
let active=null,pending=null,hourKey=null,hourState=null,macroKey=null,macroBias=null;
const seen=new Set(),trades=[],blocks={},count={signals:0};
const bars=byTf['5m'].filter(b=>b.timestamp>=start&&b.timestamp+300000<=end);
function close(bar,price,reason){
 const financial=account.close('range_edge',price,bar.timestamp+300000);
 trades.push({...active,closeTime:bar.timestamp+300000,closePrice:price,closeReason:reason,...financial});active=null;
}
for(const bar of bars){
 const ts=bar.timestamp+300000;account.advance(bar.timestamp);
 if(pending&&!active){
  const levels=rangeEdgeLevels(pending.setup,bar.open);
  if(levels){
   const admit=account.tryOpen({key:'range_edge',side:pending.setup.side,entry:bar.open,stopLoss:levels.stopLoss,time:bar.timestamp});
   if(admit.accepted)active={side:pending.setup.side,entryTime:bar.timestamp,entryPrice:bar.open,detectedAt:pending.detectedAt,...levels,setup:pending.setup};
  }else blocks.levels=(blocks.levels||0)+1;
  pending=null;
 }
 if(active){
  const isLong=active.side==='long';const sl=isLong?bar.low<=active.stopLoss:bar.high>=active.stopLoss;
  const tp=isLong?bar.high>=active.takeProfit:bar.low<=active.takeProfit;
  if(sl)close(bar,active.stopLoss,'stop_loss');else if(tp)close(bar,active.takeProfit,'take_profit');
  else if(ts-active.entryTime>=12*3600000)close(bar,bar.close,'max_hold');
 }
 account.advance(ts);
 if(active)continue;
 const hourly=candleUtils.closedCandlesUpTo(byTf['1h'],ts,'1h',150);
 if(hourly.length<50)continue;
 if(hourKey!==hourly.at(-1).timestamp){hourKey=hourly.at(-1).timestamp;hourState=computeRegimeEvidence(hourly,{timeframe:'1h'});}
 if(hourState.regime!=='range')continue;
 const macro=candleUtils.closedCandlesUpTo(byTf['4h'],ts,'4h',120);
 if(macroKey!==macro.at(-1)?.timestamp){macroKey=macro.at(-1)?.timestamp;macroBias=classifyStructureBias(macro,{strength:2}).bias;}
 const local=candleUtils.closedCandlesUpTo(byTf['5m'],ts,'5m',2);
 const setup=detectRangeEdgeRejection({local,hourly,hourlyRegime:hourState.regime,macroBias});
 if(!setup)continue;
 const key=setup.side+':'+hourKey;if(seen.has(key))continue;seen.add(key);count.signals++;
 pending={setup,detectedAt:ts};
}
if(active)close(bars.at(-1),bars.at(-1).close,'end_of_data');
function stats(rows){let gains=0,loss=0,net=0,peak=0,dd=0;for(const t of rows){net+=t.netUsd;gains+=Math.max(0,t.netUsd);loss+=Math.max(0,-t.netUsd);peak=Math.max(peak,net);dd=Math.max(dd,peak-net);}return {trades:rows.length,net,profitFactor:loss?gains/loss:null,closedEquityDrawdown:dd};}
const result={plan,signals:count.signals,blocks:{...blocks,...account.blocks},initialWallet:34.27714639,endingWallet:account.wallet,full:stats(trades),earlier120d:stats(trades.filter(t=>t.entryTime<split)),recent60d:stats(trades.filter(t=>t.entryTime>=split)),trades};
if(Math.abs(trades.reduce((s,t)=>s+t.netUsd,0)-(account.wallet-34.27714639))>1e-8)throw Error('Cash ledger mismatch');
fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({signals:result.signals,blocks:result.blocks,full:result.full,earlier120d:result.earlier120d,recent60d:result.recent60d}));
