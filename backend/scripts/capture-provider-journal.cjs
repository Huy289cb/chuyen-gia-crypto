// SELECT-only independent evidence. This store mirrors pipeline events: never sum both.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm'),ts=require('typescript');
const {PrismaClient}=require('@prisma/client'),{pickProviderMetadata}=require('./provider-metadata.cjs');
const [sinceArg,out,throughArg]=process.argv.slice(2),since=new Date(sinceArg);if(!out||!Number.isFinite(+since)||fs.existsSync(out))throw Error('ISO_SINCE NEW_EXPORT');
const source=fs.readFileSync(path.join(__dirname,'../src/utils/provider-cost-journal.ts'),'utf8'),m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports});
const db=new PrismaClient();
(async()=>{const result=await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await require('./verify-provider-journal-schema.cjs').verifyProviderJournalSchema(tx);
 const [clock]=await tx.$queryRaw`SELECT CURRENT_TIMESTAMP AS cutoff`;const transaction_started_at=new Date(clock.cutoff);const through=throughArg?new Date(throughArg):transaction_started_at;if(!Number.isFinite(+through)||through>transaction_started_at)throw Error('future_or_invalid_cutoff');if(since>through)throw Error('future_since');
 const rows=await tx.$queryRaw`SELECT request_id,event_type,metadata,recorded_at FROM public.provider_request_journal WHERE recorded_at>=${since} AND recorded_at<=${through} ORDER BY recorded_at,request_id,event_type LIMIT 20000`;
 if(rows.length===20000)throw Error('export_truncated');
 const events=rows.map(row=>{const data=pickProviderMetadata(row.metadata);if(data.request_id!==row.request_id||!['llm_provider_request','llm_provider_result'].includes(row.event_type)||!(row.recorded_at instanceof Date)||!Number.isFinite(+row.recorded_at))throw Error('invalid_journal_row');return {request_id:row.request_id,event_type:row.event_type,event_data:data,recorded_at:row.recorded_at.toISOString()};});
 const [observed]=await tx.$queryRaw`SELECT clock_timestamp() AS cutoff`;const snapshot_observed_at=new Date(observed.cutoff);
 return {schema:'independent-provider-export-v1',since:since.toISOString(),through:through.toISOString(),snapshot_observed_at:snapshot_observed_at.toISOString(),availability_basis:'visible_at_collection_snapshot_not_commit_visibility_at_event_cutoff',source_table:'public.provider_request_journal',events,cost_journal:m.exports.buildProviderCostJournal(events),request_coverage:'not_established',limits:'Only rows visible in repeatable-read snapshot and insertion-clock window; not commit ordering, boundary-spanning pairs, all attempts, or complete billing. Do not add mirrored pipeline costs.'};
 },{isolationLevel:'RepeatableRead',timeout:30000});
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');result.collector_sha256=sha(fs.readFileSync(__filename));result.cost_contract_sha256=sha(source);fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log({events:result.events.length,through:result.through,knownSubtotalUsd:result.cost_journal.knownSubtotalUsd,totalCostUsd:null});
})().catch(()=>{console.error('independent_provider_capture_failed');process.exitCode=1;}).finally(()=>db.$disconnect());
