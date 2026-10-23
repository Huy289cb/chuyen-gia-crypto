import {it,expect} from 'vitest';
import {buildSetupRegistry} from '../../src/utils/setup-registry';
const setup_id='a'.repeat(64);
const row={id:1,timestamp:'2026-10-02T00:00:00Z',event_type:'gate_funnel_shadow',event_data:{setup_identity:{schema:'setup-anchor-identity-v1',status:'known',setup_id,detection_known_at:Date.parse('2026-10-01T23:59:00Z')}}};
it('materializes persisted observations without inflating setups or inventing waves',()=>{
 const r=buildSetupRegistry([row,{...row,id:2,timestamp:'2026-10-02T00:01:00Z'},row],Date.parse('2026-10-02T01:00:00Z'));
 expect(r.coverage).toMatchObject({known:2,duplicate:1});expect(r.setups).toHaveLength(1);
 expect(r.setups[0].first_seen_at).toBe(Date.parse(row.timestamp));expect(r.setups[0].confirmed_at).toBeNull();expect(r.independent_wave_count).toBeNull();
});
it('keeps archive unknown and excludes future knowledge at a fixed cutoff',()=>{
 const r=buildSetupRegistry([{...row,id:2,event_data:{}},{...row,id:3,timestamp:'2026-10-03T00:00:00Z'},
 {...row,id:4,event_data:{setup_identity:{...row.event_data.setup_identity,detection_known_at:Date.parse('2026-10-04T00:00:00Z')}}}],Date.parse(row.timestamp));
 expect(r.coverage).toMatchObject({unknown:1,future:1,rejected:1});expect(r.setups).toHaveLength(0);
});
it('links persisted anchor evidence causally and never revises a past child when parent arrives later',()=>{
 const baseTime=Date.parse('2026-10-02T00:00:00Z');
 const measured=(id:number,setup:string,tf:string,known:number)=>({...row,id,timestamp:new Date(known).toISOString(),event_data:{setup_identity:{...row.event_data.setup_identity,setup_id:setup,detection_known_at:known-1000,
  anchor_evidence:{symbol:'BTC',side:'long',timeframe:tf,high:110,low:90,high_open:baseTime-3600000,low_open:baseTime-2700000}}}});
 const parent=measured(10,'c'.repeat(64),'15m',baseTime);
 const child=measured(11,'d'.repeat(64),'5m',baseTime+60000);
 const r=buildSetupRegistry([child,parent],baseTime+120000);
 expect(r.wave_associations[1].status).toBe('linked');
 const delayed=buildSetupRegistry([child,{...parent,timestamp:new Date(baseTime+90000).toISOString()}],baseTime+120000);
 expect(delayed.wave_associations[0].status).toBe('unknown');expect(delayed.independent_wave_count).toBeNull();
});
