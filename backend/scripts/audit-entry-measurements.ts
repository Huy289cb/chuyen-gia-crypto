/** Offline audit of saved JSON events, including the original decision 997. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { auditEntryTraces } from '../src/utils/entry-trace-audit';
import { measurePlanGeometry } from '../src/utils/plan-feasibility';
const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error('Usage: tsx scripts/audit-entry-measurements.ts EVENTS.json NEW_REPORT.json');
const bytes = readFileSync(file), parsed = JSON.parse(bytes.toString());
const rows = Array.isArray(parsed) ? parsed : parsed.events;
if (!Array.isArray(rows)) throw new Error('Expected event array');
const events = rows.map(r=>({event_type:r.event_type ?? r.type,
  event_data:typeof r.event_data === 'string' ? JSON.parse(r.event_data) : r.event_data ?? r.data}));
const levels = events.filter(e=>e.event_type === 'execution_blocked' && e.event_data.entry != null).map(e=>{
  const d=e.event_data;
  return { decisionId:d.decision_id, source:'recorded_levels', measurement:measurePlanGeometry({
    side:d.action === 'sell' ? 'short' : 'long', entry:d.entry,stopLoss:d.stop_loss,takeProfit:d.take_profit,
    minSlFraction:.008,minRr:3 }), policy:'core diagnostic 0.8%/RR3; range must be evaluated separately' };
});
writeFileSync(out,JSON.stringify({sourceHash:createHash('sha256').update(bytes).digest('hex'),
  audit:auditEntryTraces(events),recordedLevelChecks:levels},null,2),{flag:'wx'});
console.log(JSON.stringify({events:events.length,recordedLevelChecks:levels.length}));
