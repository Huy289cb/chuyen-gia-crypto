// Directional price response, not a trade simulation or portfolio result.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [source,cache,out]=process.argv.slice(2);if(!out)throw Error('Usage: FUNNEL CANDLE_CACHE NEW_REPORT');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),bytes=fs.readFileSync(source),observations=JSON.parse(bytes),files=new Map();
const rows=observations.filter(r=>['long','short'].includes(r.event_data.side)).map(r=>{
 const d=r.event_data,reference=d.breakout_metrics?.lastClose,start=Math.ceil(Date.parse(r.timestamp)/60000)*60000;
 const horizons=[60,240].map(minutes=>{
  const end=start+minutes*60000,bars=[];
  for(let day=Math.floor(start/86400000)*86400000;day<end;day+=86400000){
   const file=path.join(cache,day+'.json');if(!fs.existsSync(file))continue;
   if(!files.has(file)){const data=fs.readFileSync(file);files.set(file,{hash:sha(data),bars:JSON.parse(data)});}
   bars.push(...files.get(file).bars.filter(b=>b.openTime>=start&&b.openTime<end));
  }
  if(!(reference>0)||bars.length!==minutes||!bars.every((b,i)=>b.openTime===start+i*60000&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)))return {minutes,status:'unknown',observedBars:bars.length};
  const sign=d.side==='long'?1:-1;
  return {minutes,status:'observed',directionalReturnPct:sign*(bars.at(-1).close/reference-1)*100,
   favorablePct:Math.max(0,...bars.map(b=>sign*((sign===1?b.high:b.low)/reference-1)*100)),
   adversePct:Math.max(0,...bars.map(b=>-sign*((sign===1?b.low:b.high)/reference-1)*100))};
 });
 return {eventId:r.id,time:r.timestamp,observationKey:d.observation_key,side:d.side,playbook:d.playbook,reference,
  structureBias:d.structure_detail?.bias??d.structure_bias??'unknown',timeframe:d.timeframe,
  proxyGeometry:d.feasibility?.geometry??null,horizons};
});
const result={schema:'directional-funnel-response-v1',sourceHash:sha(bytes),scriptHash:sha(fs.readFileSync(__filename)),rows,
 candleHashes:Object.fromEntries([...files].map(([f,v])=>[f,v.hash])),
 limits:['Closed-bar proxy reference, not executable entry.','Excluded partial observation minute.','Repeated signals are not independent setups.','No costs, fills or ROI: this describes price response only.','Observed development data, not untouched validation.']};
fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(rows,null,2));
