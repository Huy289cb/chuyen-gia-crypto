const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto'),{generate}=require('./generate-range-entry-experiments.cjs');
const root=path.resolve(__dirname,'../..'),base=root+'/docs/audits/2026-09-24-live-testbed',out=root+'/docs/audits/2026-09-25-entry-experiments',read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protocol=read(out+'/protocol.json'),market=read(base+'/market.json'),entries=read(out+'/entries.json'),seeds=read(base+'/events.json').filter(e=>e.type==='transition_retest_candidate'&&e.value.candidate_kind==='range_sweep_reclaim'&&e.value.side==='long'&&e.value.timeframe==='5m');
assert.equal(sha(base+'/market.json'),protocol.sourceMarketHash);assert.equal(sha(path.resolve(__dirname,'generate-range-entry-experiments.cjs')),protocol.scriptHash);
assert.equal(new Set(entries.map(e=>e.candidate.id)).size,entries.length);
for(const e of entries){
 assert(e.candidate.time>e.sourceLastClose&&e.sourceLastClose>e.seedAt);
 const prefix=generate(seeds.filter(s=>s.at<e.candidate.time),market.byTf['5m'].filter(b=>b[0]+300000<=e.sourceLastClose),protocol.end);
 assert.deepEqual(prefix.entries.find(x=>x.candidate.id===e.candidate.id),e,'Signal changes after future bars removed');
 const c=e.candidate;assert(Math.abs(c.entry-c.stopLoss)/c.entry>=.008-1e-9);
 assert(c.side==='long'?c.stopLoss<c.entry&&c.takeProfit>c.entry:c.stopLoss>c.entry&&c.takeProfit<c.entry);
}
const checks={marketHash:true,generatorHash:true,uniqueIds:true,causalPrefixChecks:entries.length,stopFloorAndGeometry:true};
if(fs.existsSync(out+'/summary.json')){
 const rows=read(out+'/summary.json');assert.equal(rows.length,48);
 for(const row of rows){const file=`${row.period}-${row.variant}-${row.ai?'ai':'rules'}-${row.cost}.json`,r=read(out+'/'+file);assert(Math.abs(r.closes.reduce((s,c)=>s+c.netUsd,0)-row.netUsd)<1e-8);}
 checks.portfolioCashReconciliations=rows.length;
 const rs=read(out+'/reviews.json');assert.deepEqual(new Set(rs.map(r=>r.id)),new Set(entries.map(e=>e.candidate.id)));checks.aiCoverage=rs.length;checks.aiErrors=rs.filter(r=>r.error).length;
}
fs.writeFileSync(out+'/verification.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
