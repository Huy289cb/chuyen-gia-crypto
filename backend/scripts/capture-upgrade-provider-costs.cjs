// SELECT-only telemetry checkpoint, explicit since; never export provider prompts/responses.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),crypto=require('node:crypto'),{prisma}=require('../dist/lib/prisma');
const {pickProviderMetadata}=require('./provider-metadata.cjs');
const [sinceArg,out]=process.argv.slice(2),since=new Date(sinceArg);
if(!out||!Number.isFinite(+since)||fs.existsSync(out))throw Error('Usage: ISO_SINCE NEW_EXPORT');
(async()=>{
 const result=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const [clock]=await tx.$queryRawUnsafe('SELECT CURRENT_TIMESTAMP AS cutoff');
  const through=new Date(clock.cutoff);if(since>through)throw Error('future_since');
  const rows=await tx.testnetTradeEvent.findMany({where:{event_type:{in:['llm_provider_request','llm_provider_result']},timestamp:{gte:since,lte:through}},orderBy:{id:'asc'},take:20000,select:{id:true,timestamp:true,event_type:true,event_data:true}});
  if(rows.length===20000)throw Error('export_truncated');
  const events=rows.map(row=>({...row,event_data:pickProviderMetadata(typeof row.event_data==='string'?JSON.parse(row.event_data):row.event_data)}));
  return {schema:'upgrade-provider-export-v1',since:since.toISOString(),through:through.toISOString(),events,source:'SELECT-only repeatable-read telemetry checkpoint; provider metadata whitelist only; prompts/responses/headers excluded'};
 },{isolationLevel:'RepeatableRead'});
 result.collector_sha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 const stages={};for(const e of result.events){const key=e.event_data.stage??e.event_type;stages[key]=(stages[key]??0)+1;}
 console.log(JSON.stringify({events:result.events.length,stages,through:result.through}));
})().catch(e=>{console.error('telemetry_capture_failed:'+e.constructor.name);process.exitCode=1;}).finally(()=>prisma.$disconnect());
