// Read-only prefilter inventory and public candles; no model or trading calls.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),{prisma}=require('../dist/lib/prisma');
const [sinceArg,out]=process.argv.slice(2),since=new Date(sinceArg),through=new Date();
if(!out||fs.existsSync(out)||!Number.isFinite(+since)||since>=through)throw Error('invalid_capture_arguments');
(async()=>{
 const rows=await prisma.testnetTradeEvent.findMany({where:{event_type:'gate_funnel_shadow',timestamp:{gte:since,lte:through}},orderBy:{id:'asc'},take:20000,select:{id:true,timestamp:true,event_data:true}});
 if(rows.length===20000)throw Error('inventory_limit');
 const events=rows.map(r=>({...r,event_data:JSON.parse(r.event_data)}));
 const candles={};
 for(const [tf,step]of Object.entries({'5m':300000,'15m':900000,'1h':3600000,'4h':14400000})){
  const bars=[];let cursor=Math.floor((+since-step*125)/step)*step;
  while(cursor<+through){
   const url=new URL('https://fapi.binance.com/fapi/v1/klines');
   for(const [k,v]of Object.entries({symbol:'BTCUSDT',interval:tf,startTime:cursor,endTime:+through,limit:1500}))url.searchParams.set(k,String(v));
   const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('candle_http_'+response.status);
   const batch=await response.json();if(!Array.isArray(batch)||!batch.length)break;
   bars.push(...batch.map(b=>({timestamp:+b[0],open:+b[1],high:+b[2],low:+b[3],close:+b[4],volume:+b[5]})));
   const next=+batch.at(-1)[0]+step;if(next<=cursor)throw Error('nonadvancing_candles');cursor=next;
  }
  candles[tf]=bars;
 }
 const result={since:since.toISOString(),through:through.toISOString(),events,candles,
  source:'DB gate_funnel_shadow and Binance public contract klines; retrospective closed-bar reconstruction'};
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result),{flag:'wx'});
 console.log(JSON.stringify({events:events.length,directional:events.filter(e=>e.event_data.side).length,bars:Object.fromEntries(Object.entries(candles).map(([k,v])=>[k,v.length]))}));
})().catch(()=>{console.error('geometry_capture_failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
