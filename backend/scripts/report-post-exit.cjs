// Compact read-only operator report. Run from any cwd.
const fs=require('fs'),path=require('path');
const root=process.env.POST_EXIT_DATA_DIR||path.resolve(__dirname,'../data/post-exit');
const summary=JSON.parse(fs.readFileSync(path.join(root,'summary.json')));
console.log(JSON.stringify(summary,null,2));
const dir=path.join(root,'candidates'),rows=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f)))):[];
const completed=rows.filter(r=>r.observation?.status==='observed'&&r.observation.paths.every(p=>p.reason!=='pending'));
console.log(JSON.stringify({candidateCount:rows.length,pairedCompleted:completed.length,paired:completed.map(r=>({eventId:r.eventId,paths:r.observation.paths})),warning:'Conditional observations, not executable portfolio ROI'},null,2));
