// Eight fixed hypotheses (four setups x RR1.5/3), frozen before outcomes.
const {features:baseFeatures}=require('./screen-new-signals.cjs');
function features(rows){
 const out=baseFeatures(rows);let gain=0,loss=0,day=-1,high=-Infinity,low=Infinity,priorHigh=null,priorLow=null;
 for(let i=0;i<out.length;i++){
  const b=out[i],change=i?b.close-out[i-1].close:0;
  if(i>0&&i<=14){gain+=Math.max(0,change)/14;loss+=Math.max(0,-change)/14;}
  else if(i>14){gain=(gain*13+Math.max(0,change))/14;loss=(loss*13+Math.max(0,-change))/14;}
  b.rsi=loss?100-100/(1+gain/loss):gain?100:50;
  if(b.day!==day){priorHigh=Number.isFinite(high)?high:null;priorLow=Number.isFinite(low)?low:null;day=b.day;high=-Infinity;low=Infinity;}
  high=Math.max(high,b.high);low=Math.min(low,b.low);b.priorDayHigh=priorHigh;b.priorDayLow=priorLow;
  const prior=out.slice(Math.max(0,i-20),i);b.channelHigh=prior.length?Math.max(...prior.map(x=>x.high)):null;b.channelLow=prior.length?Math.min(...prior.map(x=>x.low)):null;
  const trs=out.slice(Math.max(1,i-13),i+1).map((x,j)=>{const k=Math.max(1,i-13)+j,pc=out[k-1].close;return Math.max(x.high-x.low,Math.abs(x.high-pc),Math.abs(x.low-pc));});b.atr=trs.length?trs.reduce((s,x)=>s+x,0)/trs.length:0;
 }
 return out;
}
function detect(kind,rows,i,h){
 if(i<50||!h)return null;
 const b=rows[i],p=rows[i-1],trend=h.close>h.e20&&h.e20>h.e50?'long':h.close<h.e20&&h.e20<h.e50?'short':null;
 if(kind==='rsi_trend_reset'){
  if(trend==='long'&&p.rsi<=40&&b.rsi>40&&b.close>b.open)return 'long';
  if(trend==='short'&&p.rsi>=60&&b.rsi<60&&b.close<b.open)return 'short';
 }
 if(kind==='hourly_channel_break'&&(b.timestamp+900000)%3600000===0){
  if(trend==='long'&&h.close>h.channelHigh)return 'long';
  if(trend==='short'&&h.close<h.channelLow)return 'short';
 }
 if(kind==='compression_break'){
  const window=rows.slice(i-3,i),high=Math.max(...window.map(x=>x.high)),low=Math.min(...window.map(x=>x.low));
  if(high-low<=p.atr*1.2){if(trend==='long'&&b.close>high)return 'long';if(trend==='short'&&b.close<low)return 'short';}
 }
 if(kind==='prior_day_rejection'&&b.priorDayHigh&&b.priorDayLow){
  if(b.high>b.priorDayHigh&&b.close<b.priorDayHigh&&p.close<=b.priorDayHigh&&b.close<b.open)return 'short';
  if(b.low<b.priorDayLow&&b.close>b.priorDayLow&&p.close>=b.priorDayLow&&b.close>b.open)return 'long';
 }
 return null;
}
module.exports={name:'fixed_eight_hypotheses',outDir:'2026-09-11-signal-ai-research',features,detect,
 kinds:['rsi_trend_reset','hourly_channel_break','compression_break','prior_day_rejection'],rrs:[1.5,3],
 periods:[['early60','2026-03-10','2026-05-09'],['middle60','2026-05-09','2026-07-08'],['recent60','2026-07-08','2026-09-06']],
 rules:['Eight predeclared hypotheses, no search over parameters or choose-a-side after results. RR1.5 is research-only; live coreRR3 remains unchanged.',
 'RSI14 Wilder reset through40(long)/60(short), candle agrees,1h EMA20/50 trend agrees.',
 'Closed1h breaks prior20-hour high/low,1h EMA20/50 agrees; emitted only at hourly close.',
 'Prior three15m-bar range<=1.2xATR14, current close breaks it with1h EMA20/50 trend.',
 'Prior UTC-day high/low rejection on closed15m; previous close on inside and reversal candle. Both directions without trend filter.',
 'SL previous six15m extrema plus0.01% buffer or0.8% floor, rounded outward; fixedRR1.5/3 target, not yet structurally bounded.',
 'Next5m open fill; single position,48h max,5m ambiguous bars SL-first, actual funding,0.05% fee/side,0.1% and0.2% roundtrip slippage.',
 'Risk via ReplayAccount: BTC wallet33.59964603, target0.5%, cap3%, day10%, post-close1h. Full circuit/LLM/limit/portfolio parity not claimed.',
 'Same already-researched180day dataset split into three60day periods; these are temporal robustness checks, not independent holdout.']};
