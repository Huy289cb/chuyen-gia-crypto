// Causal entry hypotheses; original stop and target are immutable.
function variants(snapshot,bars){
 const p=snapshot.plans[0],d=p.side==='long'?1:-1,R=Math.abs(p.entry-p.stopLoss);
 const seed=snapshot.candles['5m'].at(-1);
 const make=(kind,at,entry=p.entry)=>({...p,id:p.id+':'+kind,time:at+60000,timeframe:'15m',entry,kind,sourceId:p.id});
 const out=[make('baseline',snapshot.asOf),make('limit_discount_025r',snapshot.asOf,Math.round((p.entry-d*.25*R)*10)/10)];
 let touched=false,confirmed=false,reclaimed=false;
 for(const b of bars){
  const [t,o,h,l,c]=b,end=t+300000;
  if(t<snapshot.asOf)continue;if(end>snapshot.asOf+30*60000)break;
  // Invalidation wins same-bar races; never issue a plan after a consumed barrier.
  if(d===1?(l<=p.stopLoss||h>=p.takeProfit):(h>=p.stopLoss||l<=p.takeProfit))break;
  if(!confirmed&&(d===1?c>seed.high:c<seed.low)){
   out.push(make('confirmation',end));confirmed=true;
  }
  // Touch must be on a prior closed bar, so OHLC ordering is not inferred.
  if(touched&&!reclaimed&&d*(c-p.entry)>0&&d*(c-o)>0){out.push(make('retest_reclaim',end));reclaimed=true;}
  if(d===1?l<=p.entry-.25*R:h>=p.entry+.25*R)touched=true;
 }
 return out;
}
module.exports={variants};
