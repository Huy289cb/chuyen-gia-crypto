const fs=require('node:fs'),path=require('node:path');
function startSession(root,metadata,now=Date.now){
 const startedAt=metadata.startedAt??now(),stopAt=metadata.stopAt;
 if(!Number.isSafeInteger(startedAt)||!Number.isSafeInteger(stopAt)||stopAt<startedAt)throw Error('invalid_session_window');
 const sessionId=String(startedAt);
 const record=(name,value)=>fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify(value),{flag:'wx',mode:0o600});
 record('session-'+sessionId,{...metadata,startedAt,pid:process.pid,ordersPossible:false});
 return (exitCode,loopCompleted)=>{
  const endedAt=now();
  const completed=exitCode===0&&loopCompleted===true&&endedAt>=stopAt;
  const reason=exitCode!==0?'nonzero_exit':completed?'completed_window':'early_exit';
  record('session-end-'+sessionId,{sessionId,startedAt,stopAt,endedAt,pid:process.pid,exitCode,loopCompleted,
   completedWindow:completed,reason,ordersPossible:false,
   caveat:'Process lifecycle only; capture gaps and review outcomes require separate journal audit. Missing end record may indicate forced termination.'});
 };
}
module.exports={startSession};
