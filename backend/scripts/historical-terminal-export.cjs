'use strict';
const fs=require('node:fs'),path=require('node:path');
// A failed terminal DB read must not erase the original cutoff/failure evidence.
async function exportHistoricalTerminal({out,result,database,runtime,causal,captureDerivedResult,journal}){
 const errors=[];
 const capture=async(name,work)=>{try{result[name]=await work();}catch(e){errors.push({field:name,code:e.code??null,message:e.message});}};
 if(captureDerivedResult){try{Object.assign(result,captureDerivedResult());}catch(e){errors.push({field:'external_snapshot',message:e.message});}}
 if(causal)await capture('causal_inventory',()=>causal.snapshot());
 if(runtime)await capture('diagnostics',()=>runtime.diagnostics());
 if(database){
  await capture('final_accounts',()=>database.testnetAccount.findMany());
  await capture('trade_decisions',()=>database.tradeDecision.findMany({orderBy:{id:'asc'}}));
  await capture('final_pending',()=>database.testnetPendingOrder.findMany());
  await capture('final_positions',()=>database.testnetPosition.findMany());
 }
 if(journal)await capture('terminal_command_gaps',()=>journal.gaps());
 if(database){try{await database.$disconnect();}catch(e){errors.push({field:'disconnect',message:e.message});}}
 result.terminal_export_errors=errors;result.terminal_export_complete=errors.length===0;
 result.wall_completed_at=Date.now();result.wall_seconds=(result.wall_completed_at-result.wall_started_at)/1000;
 const target=path.join(out,'result.json'),temporary=target+'.'+process.pid+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,target);
 return result;
}
module.exports={exportHistoricalTerminal};
