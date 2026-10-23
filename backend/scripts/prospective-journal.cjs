const fs=require('node:fs'),path=require('node:path');
function createJournal(root){
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const safe=k=>{if(!/^[a-zA-Z0-9_-]+$/.test(k))throw Error('invalid_journal_key');return k;};
 const exclusive=(name,value)=>{try{fs.writeFileSync(path.join(root,safe(name)+'.json'),JSON.stringify(value),{flag:'wx',mode:0o600});return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}};
 return {exclusive,record:(name,value)=>{if(!exclusive(name,value))throw Error('record_already_exists');},
  claimReview(time,limit){
   if(!Number.isFinite(time)||!Number.isInteger(limit)||limit<1||limit>24)throw Error('invalid_quota');
   const hour=Math.floor(time/3600000),day=Math.floor((time+7*3600000)/86400000);
   if(!exclusive('review-wave-'+hour,{time,day}))return null;
   for(let slot=1;slot<=limit;slot++)if(exclusive(`quota-${day}-${slot}`,{time,hour}))return {hour,day,slot};
   return null;
  }};
}
module.exports={createJournal};
