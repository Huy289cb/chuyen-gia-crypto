import { PrismaClient } from '@prisma/client';
import { journalSetupWave } from '../src/utils/setup-wave-journal';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
const output=process.argv[2];if(!output||fs.existsSync(output))throw Error('NEW_OUTPUT_DIRECTORY');
const url=new URL(process.env.ROI_ATOMIC_TEST_DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/crypto_reset_test')throw Error('isolated_database_required');
url.searchParams.set('schema','engine_'+path.basename(output).replace(/[^a-zA-Z0-9_]/g,'_'));
fs.mkdirSync(output);const setupEnv={...process.env,DATABASE_URL:url.toString()};for(const key of ['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID'])delete setupEnv[key];const setup=cp.spawnSync(path.resolve('backend/node_modules/.bin/prisma'),['db','push','--skip-generate'],{cwd:path.resolve('backend'),env:setupEnv,encoding:'utf8',timeout:60000});if(setup.status!==0){fs.writeFileSync(path.join(output,'setup-failure.json'),JSON.stringify({status:setup.status,signal:setup.signal,error:setup.error?.message,stderr:setup.stderr.replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[redacted-database-url]')},null,2));throw Error('schema_setup_failed:'+setup.status+':'+setup.signal);}
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const proof: Record<string,unknown>={schema:'setup-wave-journal-proof-v1',fixture:true,production_touched:false,independent_opportunities:null};
async function main(){
 const base=Date.parse('2025-02-01T00:00:00Z'),position='pipeline_v3_kim_nghia';
 const account=await db.testnetAccount.create({data:{symbol:'BTC',method_id:'kim_nghia',starting_balance:31.47744546,current_balance:31.47744546,equity:31.47744546}});
 await db.testnetPosition.create({data:{position_id:position,account_id:account.id,symbol:'BTC',side:'NONE',entry_price:0,stop_loss:0,take_profit:0,size_usd:0,size_qty:0,risk_usd:0,risk_percent:0,expected_rr:0,status:'closed'}});
 const identity=(id:string,tf:string,highOpen:number,lowOpen:number,known:number,high=102000)=>({schema:'setup-anchor-identity-v1',status:'known',setup_id:id.repeat(64),wave_id:null,anchor_evidence:{symbol:'BTC',side:'long',timeframe:tf,high,low:100000,high_open:highOpen,low_open:lowOpen},anchor_known_at:known,detection_known_at:known});
 const persist=(i:unknown,at:number)=>db.$transaction(async tx=>{
  const data=await journalSetupWave(tx,position,{setup_identity:i},at);
  await tx.testnetTradeEvent.create({data:{position_id:position,event_type:'fixture_observation',event_data:JSON.stringify(data),timestamp:new Date(at)}});return data;
 });
 const parent=await persist(identity('a','1h',base,base+3600000,base+7200000),base+7200000);
 assert.equal((parent.setup_identity as any).wave_id,null);
 const child=identity('b','5m',base+600000,base+3900000,base+7205000);
 const linked=await persist(child,base+7205000);assert.equal((linked.wave_association as any).status,'linked');
 const repeated=await persist(child,base+7800000);assert.equal((repeated.setup_identity as any).wave_id,(linked.setup_identity as any).wave_id);
 const different=await persist(identity('c','5m',base+600000,base+3900000,base+7800000,103000),base+7800000);
 assert.equal((different.setup_identity as any).wave_id,null);
 const before=await db.testnetTradeEvent.count();await assert.rejects(persist(identity('d','5m',base,base,base+9000000),base+8000000),/future_setup_wave_evidence/);assert.equal(await db.testnetTradeEvent.count(),before);
 await Promise.all([persist(child,base+8100000),persist(child,base+8100000)]);
 const registry=await db.testnetTradeEvent.findMany({where:{event_type:'setup_anchor_first_observed'}});assert.equal(registry.length,3);
 // No process cache: a new DB client reconstructs the association from durable events.
 const restarted=new PrismaClient({datasources:{db:{url:url.toString()}}});try{const row=await restarted.$transaction(tx=>journalSetupWave(tx,position,{setup_identity:child},base+8200000));assert.equal((row.setup_identity as any).wave_id,(linked.setup_identity as any).wave_id);}finally{await restarted.$disconnect();}
 proof.passed=true;proof.checks=['verified_parent_child','repeat_same_wave','different_boundaries_unknown','future_evidence_no_write','concurrent_idempotent_registry','restart_durable_wave'];proof.registry=registry;proof.events=await db.testnetTradeEvent.findMany();
}
main().catch(e=>{proof.passed=false;proof.failure=e.message;process.exitCode=1}).finally(async()=>{await db.$disconnect();fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:proof.passed,failure:proof.failure}));});
