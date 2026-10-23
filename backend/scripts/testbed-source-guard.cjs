const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function fingerprint(roots){
 const files=[];
 function walk(p){const stat=fs.lstatSync(p);if(stat.isSymbolicLink())throw new Error('symlink_in_trial_sources');
  if(stat.isDirectory())for(const name of fs.readdirSync(p).sort())walk(path.join(p,name));else if(stat.isFile())files.push(p);}
 for(const p of roots)walk(path.resolve(p));
 return Object.fromEntries(files.sort().map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
}
function createSourceGuard(roots){
 const initial=fingerprint(roots);
 return {initial,verify(){if(JSON.stringify(initial)!==JSON.stringify(fingerprint(roots)))throw new Error('trial_sources_changed');return initial;}};
}
module.exports={createSourceGuard};
