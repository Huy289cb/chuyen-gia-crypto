'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {PrismaClient}=require('@prisma/client');const {createPortfolioCommandJournal}=require('./portfolio-command-journal-stored-key.cjs');
const schema='engine_journal_stored_key_20261007',table='"'+schema+'".testnet_trade_events';
const container=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0];
const vars=Object.fromEntries(container.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
if(container.NetworkSettings.Ports['5432/tcp'][0].HostPort!=='55439')throw Error('isolated_only');
const u=new URL(`postgresql://${encodeURIComponent(vars.POSTGRES_USER||'postgres')}:${encodeURIComponent(vars.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`);u.searchParams.set('schema',schema);
const db=new PrismaClient({datasources:{db:{url:u.toString()}}});const out=path.resolve(__dirname,'../../docs/audits/2026-10-07-journal-throughput/stored-key-scale.json');if(fs.existsSync(out))throw Error('new_artifact_required');
const report={scope:'synthetic command-storage performance, not economic portfolio',samples:[],passed:false,status:'running',wall_started_at:Date.now()};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
(async()=>{
await db.$executeRawUnsafe("SET statement_timeout='5s'");
await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
await db.$executeRawUnsafe(`CREATE TABLE ${table}(id SERIAL PRIMARY KEY,position_id text NOT NULL,event_type text NOT NULL,event_data text,"timestamp" timestamp NOT NULL DEFAULT now())`);
const journal=createPortfolioCommandJournal({database:db,positionId:'scale',storageSchema:schema});await journal.prepare();
let seeded=0;
for(const size of [10000,100000]){
await db.$executeRawUnsafe(`INSERT INTO ${table}(position_id,event_type,event_data) SELECT 'scale',e.kind,json_build_object('command_key','seed-'||g)::text FROM generate_series($1::int,$2::int)g CROSS JOIN (VALUES('portfolio_command_started'),('portfolio_command_completed'))e(kind)`,seeded+1,size);seeded=size;
await db.$executeRawUnsafe(`ANALYZE ${table}`);
const durations=[];const sample={historical_pairs:size,pair_samples_ms:durations};report.samples.push(sample);save();for(let i=0;i<20;i++){const t=performance.now(),at=Date.UTC(2025,1,1)+i*60000;const key=await journal.begin({kind:'scale',at});await journal.complete({command_key:key,kind:'scale',at,operations:[]});durations.push(performance.now()-t);save();}
durations.sort((a,b)=>a-b);Object.assign(sample,{p50_ms:durations[9],p95_ms:durations[18],max_ms:durations[19]});save();
}
report.gaps=(await journal.gaps()).length;report.passed=report.gaps===0&&report.samples.at(-1).p95_ms<=250;report.status=report.passed?'passed':'performance_gate_failed';
})().catch(e=>{report.failure=e.message;report.status='failed';process.exitCode=1}).finally(async()=>{await db.$disconnect();save();console.log(JSON.stringify(report));});
