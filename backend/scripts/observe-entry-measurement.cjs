// Read-only post-deployment evidence; no scheduler, AI or order invocation.
require('dotenv').config({quiet:true});
const fs=require('fs');
const {prisma}=require('../dist/lib/prisma');
const {ACTIVE_TESTNET_POSITION_STATUSES,BLOCKING_PENDING_ORDER_STATUSES}=require('../dist/repositories/testnet.repository');
const {auditEntryTraces}=require('../dist/utils/entry-trace-audit');
const out='../docs/deployments/2026-09-15-entry-measurement';
(async()=>{
 const since=new Date(JSON.parse(fs.readFileSync(out+'/deployment-manifest.json')).deployedAt);
 const rows=await prisma.testnetTradeEvent.findMany({where:{timestamp:{gte:since},event_type:{in:['entry_trace','gate_funnel_shadow','llm_provider_request','llm_provider_result','pending_order_linked','entry_order_filled','retest_feasibility_pair']}},orderBy:{id:'asc'},take:10001,select:{id:true,timestamp:true,event_type:true,event_data:true}});
 let malformed=0;const events=rows.slice(0,10000).flatMap(r=>{try{return [{...r,event_data:JSON.parse(r.event_data||'{}')}]}catch{malformed++;return []}});
 const result={checkedAt:new Date().toISOString(),since,truncated:rows.length>10000,malformed,heartbeats:await prisma.schedulerHeartbeat.findMany(),activePositions:await prisma.testnetPosition.count({where:{status:{in:ACTIVE_TESTNET_POSITION_STATUSES}}}),blockingPending:await prisma.testnetPendingOrder.count({where:{status:{in:BLOCKING_PENDING_ORDER_STATUSES}}}),audit:auditEntryTraces(events),funnel:events.filter(r=>r.event_type==='gate_funnel_shadow').map(r=>({id:r.id,timestamp:r.timestamp,...r.event_data})),events};
 fs.writeFileSync(out+'/post-start-observation.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({checkedAt:result.checkedAt,heartbeats:result.heartbeats,activePositions:result.activePositions,blockingPending:result.blockingPending,events:events.length,funnel:result.funnel.map(x=>({id:x.id,measurement_version:x.measurement_version,legacy_control_fields_preserved:x.legacy_control_fields_preserved})),audit:result.audit}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
