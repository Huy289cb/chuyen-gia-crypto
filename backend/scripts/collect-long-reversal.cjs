// Read-only public market requests. No order calls, provider calls, or DB writes.
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {getKlines,getServerTime}=require('../dist/services/binance/market');
const {get}=require('../dist/services/binance/client');
const {config}=require('../dist/services/binance/config');
const out=path.resolve('../docs/audits/2026-09-24-long-reversal');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const db=JSON.parse(fs.readFileSync(out+'/db.json'));const now=await getServerTime();
 const protocol={frozenAt:new Date().toISOString(),serverTime:now,source:new URL(config.BASE_URL).hostname,
  dbSha256:sha(fs.readFileSync(out+'/db.json')),cohort:'All17 actual long entries since2026-08-01, including winners. Latest6 reported separately, selected after observing losses.',
  variants:['original_long_fixed_initial_levels','short_mirror_same_distances','short_swap_original_sl_tp'],
  entry:'Conditional on actual original fill price/quantity/time. Exclude entry minute; no claim inverse order could obtain identical fill. Initial levels recovered from entry event, never amended/current SL.',
  horizon:'72h after fill, capped at latest fully closed minute. Partial windows reported separately. Stop-first ambiguity, gap adverse,0.05%fee per side,0.1%/0.2%roundtrip slip,actual funding mark.',
  promotionEligible:false};
 const protocolFile=out+'/protocol.json';if(fs.existsSync(protocolFile)){const old=JSON.parse(fs.readFileSync(protocolFile));if(old.dbSha256!==protocol.dbSha256)throw Error('DB snapshot changed');protocol.serverTime=old.serverTime;}else fs.writeFileSync(protocolFile,JSON.stringify(protocol,null,2),{flag:'wx'});
 for(const p of db.positions){
  const file=out+'/'+p.position_id+'-market.json';if(fs.existsSync(file))continue;
  const start=Math.ceil(Date.parse(p.entry_time)/60000)*60000,end=Math.min(Math.floor(protocol.serverTime/60000)*60000,start+72*3600000);
  const minutes=[];for(let cursor=start;cursor<end;){const page=await getKlines('BTCUSDT','1m',1500,cursor,end-1);if(!page.length)throw Error('Missing minute page');
   for(const b of page){if(b.openTime>=end)continue;if(b.openTime!==(minutes.length?minutes.at(-1).openTime+60000:start))throw Error('Noncontiguous minutes');minutes.push(b);}cursor=minutes.at(-1).openTime+60000;}
  if(minutes.length!==(end-start)/60000)throw Error('Incomplete minutes');
  const funding=await get('/fapi/v1/fundingRate',{symbol:'BTCUSDT',startTime:start,endTime:end-1,limit:1000});if(!Array.isArray(funding))throw Error('Bad funding response');
  const context={};for(const tf of ['5m','1h','4h'])context[tf]=await getKlines('BTCUSDT',tf,121,null,Math.floor(Date.parse(p.entry_time)/60000)*60000-1);
  fs.writeFileSync(file,JSON.stringify({start,end,full72h:end-start===72*3600000,minutes,funding,context}));console.log(JSON.stringify({id:p.position_id,minutes:minutes.length,funding:funding.length}));
 }
 const manifest=Object.fromEntries(fs.readdirSync(out).filter(f=>f.endsWith('-market.json')).map(f=>[f,sha(fs.readFileSync(out+'/'+f))]));
 fs.writeFileSync(out+'/market-manifest.json',JSON.stringify(manifest,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
