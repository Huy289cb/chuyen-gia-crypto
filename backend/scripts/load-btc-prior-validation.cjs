const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const out=path.resolve(root,'../docs/audits/2026-09-07-btc-target-room-prior');fs.mkdirSync(out,{recursive:true});
const start=new Date('2025-09-11T00:00:00Z'),end=new Date('2026-03-10T00:00:00Z');
(async()=>{
 const file=out+'/candles.json';
 if(!fs.existsSync(file)){
  const {loadBacktestCandles}=require(root+'/src/backtest/candle-loader');
  const loaded=await loadBacktestCandles({symbol:'BTC',weeks:26,timeframes:['5m','15m','1h','4h'],startDate:start,endDate:end,extraWarmupBarsPerTf:150});
  fs.writeFileSync(file,JSON.stringify(loaded));console.log('Candles loaded '+JSON.stringify(Object.fromEntries(Object.entries(loaded.byTf).map(([k,v])=>[k,v.length]))));
 }
 const fundFile=out+'/funding.json';
 if(!fs.existsSync(fundFile)){
  const response=await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime='+start.getTime()+'&endTime='+(end.getTime()-1)+'&limit=1000',{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Funding HTTP '+response.status);
  const rows=await response.json();if(!Array.isArray(rows)||!rows.length||rows.length>=1000)throw Error('Incomplete funding pagination');
  fs.writeFileSync(fundFile,JSON.stringify({start,end,rows},null,2));console.log('Funding rows '+rows.length);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
