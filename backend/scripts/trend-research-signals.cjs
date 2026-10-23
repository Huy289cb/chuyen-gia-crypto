/* Pure closed-candle hypotheses: no network, account reads or orders. */
function ema(rows,n){let value=rows[0][4];return rows.map(b=>(value+=(b[4]-value)*2/(n+1)));}
function generate(byTf,start,end){
 const b=byTf['15m'],h=byTf['1h'],q=byTf['4h'];
 const e=ema(b,20),h20=ema(h,20),h50=ema(h,50),q20=ema(q,20),q50=ema(q,50);
 const out={trend_pullback:[],compression_breakout:[]};let hi=-1,qi=-1;const last={trend_pullback:-Infinity,compression_breakout:-Infinity};
 for(let i=50;i<b.length;i++){
  const [t,o,H,L,c,v]=b[i],closed=t+900000,time=closed+60000;if(time<start||time>=end)continue;
  while(hi+1<h.length&&h[hi+1][0]+3600000<=closed)hi++;
  while(qi+1<q.length&&q[qi+1][0]+14400000<=closed)qi++;
  if(hi<50||qi<50)continue;
  const long=h[hi][4]>h20[hi]&&h20[hi]>h50[hi]&&q[qi][4]>q20[qi]&&q20[qi]>q50[qi];
  const short=h[hi][4]<h20[hi]&&h20[hi]<h50[hi]&&q[qi][4]<q20[qi]&&q20[qi]<q50[qi];
  if(!long&&!short)continue;const d=long?1:-1,side=long?'long':'short';
  const atr=b.slice(i-14,i).reduce((s,x,j)=>s+Math.max(x[2]-x[3],Math.abs(x[2]-b[i-15+j][4]),Math.abs(x[3]-b[i-15+j][4])),0)/14;
  const emit=(variant,entry,rawSl)=>{
   if(time-last[variant]<3600000)return;last[variant]=time;
   entry=Math.round(entry*10)/10;
   const sl=d===1?Math.floor(Math.min(rawSl,entry*.992)*10)/10:Math.ceil(Math.max(rawSl,entry*1.008)*10)/10;
   const tp=Math.round((entry+d*2*Math.abs(entry-sl))*10)/10;
   out[variant].push({id:variant+':'+t,time,timeframe:'15m',setup:variant,side,entry,stopLoss:sl,takeProfit:tp,targetBound:tp,sourceClose:closed,htfClose:Math.max(h[hi][0]+3600000,q[qi][0]+14400000)});
  };
  const touched=d===1?L<=e[i-1]&&c>e[i-1]:H>=e[i-1]&&c<e[i-1];
  if(touched&&d*(c-o)>0&&Math.abs(c-e[i-1])<=atr){const swing=b.slice(i-4,i+1);emit('trend_pullback',c,d===1?Math.min(...swing.map(x=>x[3]))-.1:Math.max(...swing.map(x=>x[2]))+.1);}
  const box=b.slice(i-12,i),top=Math.max(...box.map(x=>x[2])),bottom=Math.min(...box.map(x=>x[3]));
  const volume=b.slice(i-20,i).reduce((s,x)=>s+x[5],0)/20;
  if(top-bottom<=4*atr&&v>=1.5*volume&&(d===1?c>top:c<bottom)){
   const boundary=d===1?top:bottom;emit('compression_breakout',boundary,boundary-d*atr);
  }
 }
 return out;
}
module.exports={generate};
