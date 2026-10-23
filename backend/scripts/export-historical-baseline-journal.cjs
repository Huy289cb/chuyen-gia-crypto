'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {PrismaClient}=require('@prisma/client');
async function main(){
 const [dir,output,mode]=process.argv.slice(2);
 if(!dir||!output||fs.existsSync(output))throw Error('RUN_DIR NEW_OUTPUT [interim]');
 const manifestFile=path.join(dir,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));
 const terminalFile=path.join(dir,'result.json');
 const terminal=fs.existsSync(terminalFile)?JSON.parse(fs.readFileSync(terminalFile)):null;
 if((!terminal||terminal.status==='running')&&mode!=='interim')throw Error('terminal_result_required');
 const schema=manifest.storage_schema;
 if(!/^engine_[a-z0-9_]+$/.test(schema))throw Error('isolated_schema_required');
 const url=new URL(process.env.ROI_ATOMIC_TEST_DATABASE_URL??'');
 if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/crypto_reset_test')throw Error('isolated_database_required');
 url.searchParams.set('schema',schema);
 const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
 const snapshot=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const observed=await tx.$queryRawUnsafe('SELECT transaction_timestamp() AS observed_at');
  return {observed_at:observed[0].observed_at,events:await tx.testnetTradeEvent.findMany({orderBy:{id:'asc'}}),decisions:await tx.tradeDecision.findMany({orderBy:{id:'asc'}}),pending:await tx.testnetPendingOrder.findMany({orderBy:{id:'asc'}}),positions:await tx.testnetPosition.findMany({orderBy:{id:'asc'}}),accounts:await tx.testnetAccount.findMany({orderBy:{id:'asc'}})};
 },{isolationLevel:'RepeatableRead',timeout:120000});
 const counts={},brokenLinks=[],parseErrors=[];const decisions=new Set(snapshot.decisions.map(d=>d.id));
 for(const e of snapshot.events){counts[e.event_type]=(counts[e.event_type]??0)+1;if(!e.event_data)continue;let data;try{data=JSON.parse(e.event_data);}catch{parseErrors.push(e.id);continue;}if(data.decision_id!=null&&!decisions.has(data.decision_id))brokenLinks.push({event_id:e.id,decision_id:data.decision_id});}
 const report={schema:'historical-journal-export-v1',scope:terminal?'terminal isolated cohort snapshot':'provisional running isolated cohort snapshot',terminal_status:terminal?.status??null,manifest_sha256:crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex'),event_counts:counts,invalid_json_event_ids:parseErrors,unmatched_decision_references:brokenLinks,independent_opportunities:null,...snapshot};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({scope:report.scope,event_count:snapshot.events.length,decision_count:snapshot.decisions.length,parse_errors:parseErrors.length,unmatched_decision_references:brokenLinks.length}));
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
