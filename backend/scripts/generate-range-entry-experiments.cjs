/* Research only: causal entry alternatives from deployed scanner range candidates. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),base=root+'/docs/audits/2026-09-24-live-testbed',out=root+'/docs/audits/2026-09-25-entry-experiments';
const read=n=>JSON.parse(fs.readFileSync(base+'/'+n));
function generate(seeds,bars,end){
 const result=[],diagnostics=[];
 const round=x=>Math.round(x*10)/10;
 for(const event of seeds){
  const p=event.value,L=Number(p.adaptive_evidence.range_low),H=Number(p.adaptive_evidence.range_high),expiry=Math.min(event.at+90*60000,end);
  if(!(H>L))throw Error('invalid frozen range');
  const future=bars.filter(b=>b[0]+300000+5000>event.at&&b[0]+300000+60000<expiry);
  const emit=(variant,b,side,E,SL,TP,confirmation)=>{
   const candidate={id:p.candidate_key+':'+variant,time:b[0]+360000,timeframe:'5m',setup:variant,entry:round(E),stopLoss:round(SL),takeProfit:round(TP),targetBound:round(TP),side};
   // Outward rounding preserves the 0.8% floor after tick quantization.
   candidate.stopLoss=side==='long'?Math.min(candidate.stopLoss,Math.floor(candidate.entry*.992*10)/10):Math.max(candidate.stopLoss,Math.ceil(candidate.entry*1.008*10)/10);
   result.push({variant,seedId:p.candidate_key,seedAt:event.at,sourceLastClose:b[0]+300000,confirmation,candidate,seed:p});
  };
  let longDone=false,shortDone=false,limitDone=false,broken=false,breakTime=null;
  for(const b of future){
   const [t,o,h,l,c]=b;
   // Original seed is already a closed sweep/reclaim. Require a later distinct retest candle.
   if(!longDone&&l<=L*1.0015&&c>L&&c>o){
    const E=c,SL=Math.min(l-.1,E*.992),R=E-SL,TP=Math.min(H,E+1.5*R);
    if(TP>E){emit('reclaim_hold',b,'long',E,SL,TP,'distinct bullish retest holds frozen range low');longDone=true;}
   }
   // Improvement is a resting limit after original seed, not a retrospectively chosen fill.
   if(!limitDone){
    const E=L,SL=Math.min(p.adaptive_evidence.lastLow-.1,E*.992),TP=Math.min(H,E+1.5*(E-SL));
    if(TP>E)emit('boundary_limit',b,'long',E,SL,TP,'submit frozen boundary limit after next closed candle');limitDone=true;
   }
   if(!shortDone&&broken&&t>breakTime&&h>=L*.9985&&c<L&&c<o){
    const E=c,SL=Math.max(h+.1,E*1.008),TP=E-1.5*(SL-E);
    emit('breakdown_retest',b,'short',E,SL,TP,'closed breakdown then distinct bearish retest from below');shortDone=true;
   }
   if(!broken&&c<L*.9985){broken=true;breakTime=t;}
  }
  diagnostics.push({seedId:p.candidate_key,reclaim:longDone,limit:limitDone,breakdown:broken,short:shortDone});
 }
 return {entries:result.sort((a,b)=>a.candidate.time-b.candidate.time),diagnostics};
}
module.exports={generate};
if(require.main===module){
 const protocol=read('protocol.json'),market=read('market.json'),seeds=read('events.json').filter(e=>e.type==='transition_retest_candidate'&&e.value.candidate_kind==='range_sweep_reclaim'&&e.value.side==='long'&&e.value.timeframe==='5m');
 const rules={createdAt:new Date().toISOString(),sourceMarketHash:read('market-manifest.json').sha256,sourceSeedCount:seeds.length,variants:['reclaim_hold','boundary_limit','breakdown_retest'],expiryMinutes:90,rangeFrozenAtSeed:true,stopFloor:.008,rr:1.5,longTargetCappedByRangeHigh:true,split:protocol.start+30*86400000,start:protocol.start,end:protocol.end,selection:'First 30 days rank stress net; last 30 chronological validation, previously observed data, NOT pristine out-of-sample. No tuning after results.',scriptHash:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')};
 fs.writeFileSync(out+'/protocol.json',JSON.stringify(rules,null,2),{flag:'wx'});
 const result=generate(seeds,market.byTf['5m'],protocol.end);
 fs.writeFileSync(out+'/entries.json',JSON.stringify(result.entries));fs.writeFileSync(out+'/generation.json',JSON.stringify(result.diagnostics,null,2));console.log(JSON.stringify({seeds:seeds.length,entries:result.entries.length,counts:Object.fromEntries(rules.variants.map(v=>[v,result.entries.filter(e=>e.variant===v).length]))}));
}
