// Public GETs only. Research snapshot, no order/AI/DB calls or runtime imports with schedulers.
require('dotenv').config({quiet:true});
const fs=require('fs');const crypto=require('crypto');
const {getKlines,getServerTime}=require('../dist/services/binance/market');
const {config}=require('../dist/services/binance/config');
const {classifyStructureBias,findStructureSwings}=require('../dist/utils/structure-bias');
const {observeEntryFeasibility}=require('../dist/utils/entry-feasibility-observation');
(async()=>{
 const asOf=await getServerTime();const candles={};
 for(const tf of ['4h','1h','15m']){
  const step={'4h':14400000,'1h':3600000,'15m':900000}[tf];
  candles[tf]=(await getKlines('BTCUSDT',tf,300,null,asOf)).filter(x=>x.closeTime<asOf).map(x=>({...x,timestamp:x.openTime}));
  const a=candles[tf];if(a.length<50||asOf-(a.at(-1).timestamp+step)>step+120000||a.some((x,i)=>![x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite)||x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close)||x.volume<0||(i&&x.timestamp-a[i-1].timestamp!==step)))throw Error('Invalid/gapped/stale '+tf);
 }
 const summary={asOf:new Date(asOf).toISOString(),source:new URL(config.BASE_URL).hostname,symbol:'BTCUSDT',role:'diagnostic_only',lastM15Close:candles['15m'].at(-1).close,timeframes:{},geometry:{}};
 for(const tf of Object.keys(candles)){
  const a=candles[tf],last=a.at(-1),swings=findStructureSwings(a,2);
  summary.timeframes[tf]={bars:a.length,lastClosedAt:new Date(last.closeTime).toISOString(),bias:classifyStructureBias(a,{strength:2}),swings:swings.slice(-8),latestVolumeRatio:last.volume/(a.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/20)};
 }
 for(const side of ['long','short'])summary.geometry[side]=observeEntryFeasibility({asOf,timeframe:'15m',candles:candles['15m'],structureCandles:candles['4h'],side,minSlFraction:.008,minRr:3});
 const p='../docs/audits/2026-09-15-ict-opportunities/';const raw=JSON.stringify({asOf,source:summary.source,candles},null,2);
 fs.writeFileSync(p+'candles.json',raw);summary.candlesSha256=crypto.createHash('sha256').update(raw).digest('hex');fs.writeFileSync(p+'snapshot.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
})().catch(e=>{console.error(e.message);process.exitCode=1});
