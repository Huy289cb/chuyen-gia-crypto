// Read-only exchange evidence for recorded protective IDs; never submits or cancels orders.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const out=process.argv[2];if(!out||fs.existsSync(out))throw Error('new_output_required');
const app=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})).find(a=>a.name==='crypto-worker');
if(!app?.pid)throw Error('worker_unavailable');
Object.assign(process.env,Object.fromEntries(fs.readFileSync(`/proc/${app.pid}/environ`,'utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})));
const build=path.dirname(app.pm2_env.pm_exec_path),{prisma}=require(path.join(build,'lib/prisma')),{get}=require(path.join(build,'services/binance/client'));
const fields=['algoId','orderId','actualOrderId','orderType','type','algoStatus','status','symbol','side','positionSide','workingType','triggerPrice','stopPrice','actualPrice','avgPrice','quantity','executedQty','priceProtect','createTime','updateTime','triggerTime'];
(async()=>{
 const positions=await prisma.testnetPosition.findMany({where:{symbol:'BTC',status:'closed',close_time:{gte:new Date('2026-09-14')}},orderBy:{close_time:'desc'},take:10,
  select:{id:true,close_time:true,side:true,binance_sl_order_id:true,binance_tp_order_id:true}});
 const evidence=[];
 for(const p of positions)for(const kind of ['sl','tp']){
  const id=p[`binance_${kind}_order_id`];if(!id){evidence.push({positionId:p.id,kind,status:'missing_id'});continue;}
  const attempts=[];
  for(const [endpoint,key]of [['/fapi/v1/algoOrder','algoId'],['/fapi/v1/order','orderId']]){
   try{const raw=await get(endpoint,{symbol:'BTCUSDT',[key]:id},true);
    attempts.push({endpoint,status:'known',receivedAt:new Date().toISOString(),order:Object.fromEntries(fields.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]))});break;
   }catch(e){attempts.push({endpoint,status:'unknown',code:Number(e.binanceCode??e.code)||null});}
  }
  evidence.push({positionId:p.id,kind,id,attempts});
 }
 const replacementHistory=[];
 for(const p of positions.filter(p=>evidence.some(e=>e.positionId===p.id&&e.attempts?.some(a=>a.order?.algoStatus==='REJECTED')))){
  const endTime=+p.close_time+300000,startTime=+p.close_time-86400000;
  try{const raw=await get('/fapi/v1/allAlgoOrders',{symbol:'BTCUSDT',startTime,endTime,limit:1000},true);
   const rows=Array.isArray(raw)?raw:raw?.orders;if(!Array.isArray(rows))throw Error('invalid_response');
   replacementHistory.push({positionId:p.id,startTime,endTime,status:'known',possiblyTruncated:rows.length>=1000,
    orders:rows.map(r=>Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])))});
  }catch(e){replacementHistory.push({positionId:p.id,startTime,endTime,status:'unknown',code:Number(e.binanceCode??e.code)||null});}
 }
 const result={capturedAt:new Date().toISOString(),positions,evidence,replacementHistory,scope:'Recorded IDs plus bounded replacement history for rejected IDs. Canceled order retention and query limits may omit history. Not strategy-performance evidence.'};
 fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({positions:positions.length,known:evidence.filter(e=>e.attempts?.some(a=>a.status==='known')).length,workingTypes:evidence.flatMap(e=>e.attempts??[]).filter(a=>a.status==='known').map(a=>a.order.workingType??'missing')}));
})().catch(()=>{console.error('protective_evidence_failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
