// Offline exploratory screen. Never imports exchange/order/DB clients.
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const root=path.resolve(__dirname,'..');

function features(rows) {
 let e20=rows[0].close,e50=e20, day=-1,pv=0,vol=0;
 return rows.map((b,i)=>{
  e20+=2/21*(b.close-e20);e50+=2/51*(b.close-e50);
  const today=Math.floor(b.timestamp/86400000);
  if(today!==day){day=today;pv=0;vol=0;}
  pv+=(b.high+b.low+b.close)/3*b.volume;vol+=b.volume;
  const last=rows.slice(Math.max(0,i-19),i+1),mean=last.reduce((s,x)=>s+x.close,0)/last.length;
  const sd=Math.sqrt(last.reduce((s,x)=>s+(x.close-mean)**2,0)/last.length);
  return {...b,e20,e50,mean,upper:mean+2*sd,lower:mean-2*sd,vwap:vol?pv/vol:b.close,day};
 });
}

function detect(kind,rows,i,hour) {
 if(i<50||!hour)return null;
 const b=rows[i],prev=rows[i-1],h=hour;
 const trend=h.close>h.e20&&h.e20>h.e50?'long':h.close<h.e20&&h.e20<h.e50?'short':null;
 if(kind==='ema_pullback') {
  if(trend==='long'&&prev.close>prev.e20&&b.low<=prev.e20&&b.close>b.e20&&b.close>b.open)return 'long';
  if(trend==='short'&&prev.close<prev.e20&&b.high>=prev.e20&&b.close<b.e20&&b.close<b.open)return 'short';
 }
 if(kind==='vwap_reclaim'&&b.day===prev.day&&(b.timestamp%86400000)>=3600000) {
  if(trend==='long'&&prev.close<=prev.vwap&&b.close>b.vwap&&b.close>b.open)return 'long';
  if(trend==='short'&&prev.close>=prev.vwap&&b.close<b.vwap&&b.close<b.open)return 'short';
 }
 if(kind==='bollinger_reentry'&&Math.abs(h.e20-h.e50)/h.close<.003) {
  if(prev.close<prev.lower&&b.close>b.lower&&b.close>b.open)return 'long';
  if(prev.close>prev.upper&&b.close<b.upper&&b.close<b.open)return 'short';
 }
 return null;
}

function main(spec={}) {
 require(root+'/node_modules/dotenv').config({path:root+'/.env'});
 for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
 process.env.BINANCE_ENABLED='false';
 const {ReplayAccount}=require(root+'/src/backtest/replay-account.ts');
 const {getRiskPolicy}=require(root+'/src/config/risk-policy.ts');
 const risk=getRiskPolicy();
 if(risk.maxEffectiveRiskPerTradeUsd!==null||risk.maxEffectiveRiskPerTradePercent!==3||risk.dailyLossLimitPercent!==10||risk.lossCooldownTier2Hours!==1||risk.lossCooldownTier3Hours!==1)throw Error('Pinned policy mismatch');
 const out=path.resolve(root,'../docs/audits',spec.outDir||'2026-09-11-new-signals');fs.mkdirSync(out,{recursive:true});
 const files=['2026-09-07-entry-opportunity/candles-70f3f921d5708e18.json','2026-09-07-entry-risk-1usd-validation/candles-25bbe498be36f2af.json'];
 const merged={};
 for(const f of files){const data=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits',f)));for(const [tf,rows] of Object.entries(data.byTf)){const map=merged[tf]??=new Map();for(const b of rows){if(map.has(b.timestamp)&&JSON.stringify(map.get(b.timestamp))!==JSON.stringify(b))throw Error('Conflicting data');map.set(b.timestamp,b);}}}
 for(const tf of Object.keys(merged)){merged[tf]=[...merged[tf].values()].sort((a,b)=>a.timestamp-b.timestamp);const step={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000}[tf];for(let i=1;i<merged[tf].length;i++)if(merged[tf][i].timestamp-merged[tf][i-1].timestamp!==step)throw Error('Candle gap '+tf);}
 const buildFeatures=spec.features||features, detector=spec.detect||detect;
 const f15=buildFeatures(merged['15m']),f1h=buildFeatures(merged['1h']);
 const funding=JSON.parse(fs.readFileSync(path.resolve(root,'../docs/audits/2026-09-07-entry-opportunity/historical-funding.json'))).rows.map(r=>({time:r.fundingTime,rate:Number(r.fundingRate),markPrice:Number(r.markPrice)}));
 const kinds=spec.kinds||['ema_pullback','vwap_reclaim','bollinger_reentry'];
 const periods=spec.periods||[['prior120','2026-03-10','2026-07-08'],['recent60','2026-07-08','2026-09-06']];
 const rrs=spec.rrs||[3];
 const protocol={createdAt:new Date().toISOString(),kinds,periods,initialWallet:33.59964603,risk:{cooldownMinutes:60,dailyPercent:10,tradePercent:3,targetPercent:.5,slFloor:.008,rr:3},costs:{feePerSide:.0005,base:.001,stress:.002},rules:['15m closed-bar detection with only closed1h context; fill at next5m open, zero processing delay assumption.','EMA20 touch/reject with aligned1h EMA20/50; VWAP UTC-day recross after first hour with same trend; Bollinger20/2 reentry with1h EMA spread<0.3%.','SL beyond previous six15m bars or0.8% floor, rounded outwards to0.1; TP fixedRR3. Bollinger also requires mean target room>=3R; never push its target beyond mean.','Single position per variant, max48h, conservative SL-first if both touched5m; gaps stop at open.','Wallet sizing/fees/slippage/funding/daily budget/post-close cooldown via existing ReplayAccount.'],limitations:['Exploratory on previously examined data, not untouched holdout; only one preset per signal, no tuning.','No LLM, pending limit queue, full live expectancy/drawdown circuit, leverage margin or core/range portfolio interaction.','EMA/VWAP fixedRR3 targets are hypothetical and not bounded to a structural objective; require later target validation.','Single-position screen does not establish incremental opportunity versus current bot; five-minute intrabar ordering is conservative.']};
 if(spec.rules)protocol.rules=spec.rules;
 protocol.risk.rr=rrs;protocol.experiment=spec.name||'initial_screen';
 fs.writeFileSync(out+'/protocol.json',JSON.stringify(protocol,null,2));
 const signals={};
 for(const kind of kinds){signals[kind]=[];let h=-1;for(let i=50;i<f15.length;i++){const t=f15[i].timestamp+900000;while(h+1<f1h.length&&f1h[h+1].timestamp+3600000<=t)h++;if(h<50)continue;const side=detector(kind,f15,i,f1h[h]);if(!side)continue;const window=f15.slice(i-5,i+1);signals[kind].push({time:t,side,low:Math.min(...window.map(b=>b.low)),high:Math.max(...window.map(b=>b.high)),mean:f15[i].mean});}}
 fs.writeFileSync(out+'/signals.json',JSON.stringify(signals));
 const summaries=[];
 for(const [period,start,end] of periods)for(const kind of kinds)for(const rr of rrs)for(const slip of [.001,.002]) {
  const from=Date.parse(start),to=Date.parse(end),bars=merged['5m'].filter(b=>b.timestamp>=from&&b.timestamp<to),pending=new Map(signals[kind].filter(s=>s.time>=from&&s.time<to).map(s=>[s.time,s]));
  const account=new ReplayAccount({initialWallet:protocol.initialWallet,maxRiskUsd:null,maxRiskPercent:3,targetRiskPercent:.5,maxExposureUsd:risk.maxTotalExposureUsd,dailyLossPercent:10,feePerSide:.0005,slippageFraction:slip,funding,postCloseCooldown:{winMinutes:60,lossMinutes:60}});
  let held=null,peak=account.wallet,maxDd=0;const trades=[],blocks={};const block=k=>blocks[k]=(blocks[k]??0)+1;
  const close=(price,time,reason)=>{const result=account.close(held.key,price,time);trades.push({...held,exit:price,exitTime:time,reason,...result});held=null;};
  for(const bar of bars){
   account.advance(bar.timestamp);
   const s=pending.get(bar.timestamp);
   if(s){if(held)block('open_position');else{
    const entry=bar.open,dir=s.side==='long'?1:-1;
    const rawSl=s.side==='long'?Math.min(s.low-entry*.0001,entry*(1-.008)):Math.max(s.high+entry*.0001,entry*(1+.008));
    const sl=s.side==='long'?Math.floor(rawSl*10)/10:Math.ceil(rawSl*10)/10,tp=entry+dir*Math.abs(entry-sl)*rr;
    if(kind==='bollinger_reentry'&&dir*(s.mean-entry)<Math.abs(entry-sl)*rr)block('target_room');
    else {const key=kind+':'+bar.timestamp;const a=account.tryOpen({key,side:s.side,entry,stopLoss:sl,time:bar.timestamp});if(a.accepted)held={key,side:s.side,entry,sl,tp,entryTime:bar.timestamp,qty:a.quantity};}
   }}
   if(held){const dir=held.side==='long'?1:-1;
    const stop=dir===1?bar.low<=held.sl:bar.high>=held.sl,target=dir===1?bar.high>=held.tp:bar.low<=held.tp;
    if((dir===1&&bar.open<=held.sl)||(dir===-1&&bar.open>=held.sl))close(bar.open,bar.timestamp,'gap_sl');
    else if((dir===1&&bar.open>=held.tp)||(dir===-1&&bar.open<=held.tp))close(held.tp,bar.timestamp,'gap_tp');
    else if(stop)close(held.sl,bar.timestamp+300000,target?'ambiguous_sl_first':'sl');
    else if(target)close(held.tp,bar.timestamp+300000,'tp');
    else if(bar.timestamp+300000-held.entryTime>=48*3600000)close(bar.close,bar.timestamp+300000,'timeout');
   }
   const equity=account.wallet+(held?(held.side==='long'?1:-1)*(bar.close-held.entry)*held.qty:0);
   peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak*100);
  }
  if(held)close(bars.at(-1).close,to,'end_of_data');
  const wins=trades.filter(t=>t.netUsd>0),loss=-trades.reduce((s,t)=>s+Math.min(0,t.netUsd),0),gain=wins.reduce((s,t)=>s+t.netUsd,0);
  const summary={period,kind,rr,cost:slip===.001?'base':'stress',signals:pending.size,trades:trades.length,wins:wins.length,netUsd:account.wallet-protocol.initialWallet,roiPct:(account.wallet/protocol.initialWallet-1)*100,profitFactor:loss?gain/loss:null,closeSampledDrawdownPercent:maxDd,blocks:{...blocks,...account.blocks},endOfData:trades.filter(t=>t.reason==='end_of_data').length};summaries.push(summary);const suffix=spec.name?'-rr'+rr:'';fs.writeFileSync(out+'/'+period+'-'+kind+suffix+'-'+summary.cost+'.json',JSON.stringify({summary,trades},null,2));console.log(JSON.stringify(summary));
 }
 fs.writeFileSync(out+'/summary.json',JSON.stringify(summaries,null,2));
 fs.writeFileSync(out+'/source-hashes.json',JSON.stringify(Object.fromEntries([__filename,...files.map(f=>path.resolve(root,'../docs/audits',f))].map(f=>[path.relative(root,f),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),null,2));
}
module.exports={features,detect,main};
if(require.main===module)main(process.argv[2]?require(path.resolve(process.argv[2])):{});
