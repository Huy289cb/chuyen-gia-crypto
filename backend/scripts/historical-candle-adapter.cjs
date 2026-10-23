'use strict';
// Market-data boundary for the shared production runtime, not a strategy simulator.
const fs=require('node:fs'),crypto=require('node:crypto');
const durations=Object.freeze({'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000});
function createHistoricalCandleAdapter({datasetPath,expectedSha256,readClock,graceMs=5000}){
 if(typeof readClock!=='function'||!Number.isFinite(graceMs)||graceMs<0)throw Error('explicit_historical_clock_and_grace_required');
 const bytes=fs.readFileSync(datasetPath),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 if(!expectedSha256||sha!==expectedSha256)throw Error('historical_dataset_hash_mismatch');
 const data=JSON.parse(bytes),series=new Map(),reads=[];let lastClock=-Infinity;
 for(const [tf,rows] of Object.entries(data.byTf??{})){
  const duration=durations[tf];if(!duration)throw Error('unsupported_historical_timeframe:'+tf);
  if(!Array.isArray(rows)||!rows.length)throw Error('empty_historical_series:'+tf);
  let previous=null;
  for(const row of rows){
   if(!Array.isArray(row)||row.length!==6||!row.every(Number.isFinite))throw Error('invalid_historical_bar:'+tf);
   const [t,o,h,l,c,v]=row;
   if(t%duration!==0||Math.min(o,h,l,c)<=0||v<0||h<Math.max(o,c)||l>Math.min(o,c)||l>h||(previous!==null&&t-previous!==duration))throw Error('historical_bar_gap_or_invalid_ohlcv:'+tf);
   previous=t;
  }
  series.set(tf,rows);
 }
 function getCandles({symbol,timeframe,limit=100}){
  if(!['BTC','BTCUSDT'].includes(String(symbol).toUpperCase()))throw Error('historical_symbol_not_supported');
  const rows=series.get(timeframe),duration=durations[timeframe];if(!rows)throw Error('missing_historical_timeframe:'+timeframe);
  if(!Number.isInteger(limit)||limit<=0)throw Error('invalid_historical_limit');
  const now=readClock();if(!Number.isFinite(now)||now<lastClock)throw Error('nonmonotonic_historical_clock');lastClock=now;
  // Binary search the first bar not yet finalized, including HTF and grace.
  let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][0]+duration+graceMs<=now)lo=mid+1;else hi=mid;}
  const candles=rows.slice(Math.max(0,lo-limit),lo).map(([timestamp,open,high,low,close,volume])=>({timestamp,open,high,low,close,volume}));
  reads.push({at:now,timeframe,limit,returned:candles.length,last_open:candles.at(-1)?.timestamp??null,warmup_complete:candles.length===limit});
  return {candles,source:'binance'}; // Preserve the production CandleSource enum; provenance below.
 }
 return {getCandles,diagnostics:()=>({dataset_sha256:sha,publication_basis:'modeled_bar_close_plus_grace_not_original_exchange_publication',grace_ms:graceMs,reads:reads.map(r=>({...r})),funding_mark_approximation:data.fundingMarkApproximation??null})};
}
module.exports={createHistoricalCandleAdapter};
