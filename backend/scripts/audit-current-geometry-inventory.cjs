const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [source,out]=process.argv.slice(2);if(!source||!out||fs.existsSync(out))throw Error('new_output_required');
const file=path.resolve(__dirname,'../dist/utils/entry-feasibility-observation.js');
const {observeEntryFeasibility}=require(file),bytes=fs.readFileSync(source),data=JSON.parse(bytes);
const step={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
const rows=[];
for(const e of data.events){const d=e.event_data;if(!['long','short'].includes(d.side))continue;
 const asOf=Date.parse(d.evaluated_at||e.timestamp),tf=d.timeframe;
 const past=t=>(data.candles[t]??[]).filter(c=>c.timestamp+step[t]+5000<=asOf).slice(-120);
 const m=observeEntryFeasibility({asOf,timeframe:tf,candles:past(tf),structureCandles:past('4h'),side:d.side,minSlFraction:.008,minRr:3});
 rows.push({eventId:e.id,asOf,timeframe:tf,side:d.side,playbook:d.playbook,observationKey:d.observation_key,
  wouldPassPreLlm:d.would_pass_pre_llm,measurement:m});
}
const count=rs=>rs.reduce((a,r)=>{const k=r.measurement.status;a[k]=(a[k]??0)+1;return a;},{});
// Spacing chosen without outcomes, across all timeframes/sides. Not statistical independence.
const spaced=[];for(const r of [...rows].sort((a,b)=>a.asOf-b.asOf))if(!spaced.length||r.asOf-spaced.at(-1).asOf>=4*3600000)spaced.push(r);
const report={sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),observerSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
 since:data.since,through:data.through,assumptions:{minSlFraction:.008,minRr:3,lookback:120,closedGraceMs:5000,spacingMs:14400000},
 summary:{observations:data.events.length,directional:rows.length,statuses:count(rows),spaced:spaced.length,spacedStatuses:count(spaced)},
 spacedEventIds:spaced.map(r=>r.eventId),rows,
 limits:['Diagnostic closed-bar proxies, not submitted entries.','Fixed RR3 geometry reference, not evidence all runtime lanes require RR3.',
 'Four-hour spacing reduces overlap but does not prove setup independence.','No account-admission, costs, fills or ROI inferred.','Retrospective reconstruction; no future candles used.']};
fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report.summary));
