import {it,expect} from 'vitest';
import {evaluateStructureSidePermission as evaluate} from '../../src/config/v3-structure-bias-policy';
import {replayRecordedStructurePermission as replay} from '../../src/utils/recorded-structure-permission';
const now=Date.parse('2026-10-02T14:00:00Z');
const record=(enabled=true)=>{const input={side:'long' as const,enabled,strength:2,shortRequireBos:true,longRequireBos:true,candles:[{timestamp:now-7200000,high:110,low:100,close:105},{timestamp:now-3600000,high:112,low:102,close:108}]};return {schema:'structure-permission-v1',timeframe:'1h',observed_at:new Date(now).toISOString(),input,decision:evaluate(input)};};
it('replays explicit policy on blocked and permitted paths without execution inference',()=>{
 for(const enabled of [true,false])expect(replay(record(enabled),now,now)).toMatchObject({status:'evaluated',matches_recorded:true,execution_feasibility:'not_established'});
});
it('detects altered decision and rejects future candles/cutoff/missing policy',()=>{
 const changed=record();changed.decision.pass=true;expect(replay(changed,now,now)).toMatchObject({status:'evaluated',matches_recorded:false});
 const future=record();future.input.candles[1].timestamp=now;expect(replay(future,now,now).status).toBe('unknown');
 expect(replay(record(),now,now-1).status).toBe('unknown');
 const missing=JSON.parse(JSON.stringify(record()));delete missing.input.strength;expect(replay(missing,now,now).status).toBe('unknown');
});
