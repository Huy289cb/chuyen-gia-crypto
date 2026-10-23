const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),file=path.join(pkg,'release/utils/account-wallet-journal.js');
(async()=>{let scenarios=0;for(const mode of ['ok','missing','failed']){
 const reads=[],writes=[],exports={};
 const prisma={testnetPosition:{findUnique:async args=>{reads.push(args);return mode==='missing'?null:{position_id:'pipeline_v3_kim_nghia'};}},testnetTradeEvent:{create:async args=>{writes.push(args);if(mode==='failed')throw Error('db');}}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{assert.equal(id,'../lib/prisma');return {prisma};},Date},{filename:file});
 const evidence={schema:'wallet-sync-v1',account_id:2,status:'applied'};
 if(mode==='ok')await exports.persistAccountWalletObservation(evidence);else await assert.rejects(exports.persistAccountWalletObservation(evidence));
 assert.equal(reads.length,1);assert.equal(writes.length,mode==='missing'?0:1);
 if(writes.length){assert.equal(writes[0].data.event_type,'account_wallet_sync_observed');assert.equal(writes[0].data.position_id,'pipeline_v3_kim_nghia');assert.deepEqual(JSON.parse(writes[0].data.event_data),evidence);}scenarios++;
 }
 const report={compiledPersistenceScenarios:scenarios,actualAccountPayloadPreserved:true,existingAnchorOnly:true,noAccountOrPositionCreation:true,liveDatabaseWrites:0,limits:'Mocked compiled Prisma contract, not actual DB persistence proof.'};
 fs.writeFileSync(path.join(pkg,'compiled-persistence-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
