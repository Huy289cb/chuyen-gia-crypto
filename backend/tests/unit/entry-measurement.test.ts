import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditEntryTraces } from '../../src/utils/entry-trace-audit';
import { compareRetestFeasibility } from '../../src/utils/retest-feasibility';
import { measurePlanGeometry, evaluateBoundAwareRrVariant } from '../../src/utils/plan-feasibility';
import { observeEntryFeasibility } from '../../src/utils/entry-feasibility-observation';

import { createEntryTrace, withEntryTrace, tracedEvent, currentEntryTrace } from '../../src/utils/entry-trace';

it('replays recorded decision 997 without inventing a target bound or provider linkage', () => {
  const events = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/decision-997-events.json'),'utf8'));
  const d = events.find((e: any) => e.data.decision_id === 997).data;
  const m = measurePlanGeometry({ side: 'short', entry: d.entry, stopLoss: d.stop_loss,
    takeProfit: d.take_profit, minSlFraction: .008, minRr: 3 });
  expect(m.stopFraction).toBeCloseTo(.0066416, 6);
  expect(m.requiredTargetFraction).toBeCloseTo(.024);
  expect(m.rr).toBeCloseTo(1.06815, 4);
  expect(m.blockers).toEqual(['stop_floor','missing_target_bound','rr']);
  expect(m.feasible).toBe(false);
  expect(events.filter((e: any) => e.type === 'llm_provider_request')).toHaveLength(2);
  expect(events.every((e: any) => !e.data.trace_id)).toBe(true);
});
it('cannot count unknown target, invalid prices or wrong-side stops as feasible', () => {
  expect(measurePlanGeometry({side:'long',entry:100,stopLoss:99,minSlFraction:.008,minRr:3}).feasible).toBe(false);
  expect(measurePlanGeometry({side:'long',entry:100,stopLoss:101,targetBound:110,minSlFraction:.008,minRr:3}).blockers).toContain('invalid_levels');
  expect(measurePlanGeometry({side:'long',entry:NaN,stopLoss:99,targetBound:110,minSlFraction:.008,minRr:3}).blockers).toEqual(['missing_data']);
});
it('bound-aware RR variant never drags TP through targetBound', () => {
  const entry = 100_000;
  const stopLoss = entry * (1 - 0.008);
  const targetBound = entry + (entry - stopLoss) * 1.5;
  const ok = evaluateBoundAwareRrVariant({
    side: 'long', entry, stopLoss, targetBound, minSlFraction: 0.008, minRr: 1.5,
  });
  const blocked = evaluateBoundAwareRrVariant({
    side: 'long', entry, stopLoss, targetBound, minSlFraction: 0.008, minRr: 3,
  });
  expect(ok.pass).toBe(true);
  expect(ok.takeProfit!).toBeLessThanOrEqual(targetBound + 1e-9);
  expect(blocked.pass).toBe(false);
  expect(blocked.reason).toBe('target_room');
});
it('measures improved retest geometry without counting it as a filled trade', () => {
  const first = measurePlanGeometry({side:'long',entry:100,stopLoss:99,targetBound:102.3,minSlFraction:.008,minRr:3});
  const retest = measurePlanGeometry({side:'long',entry:99.8,stopLoss:99,targetBound:102.3,minSlFraction:.008,minRr:3});
  expect(first.blockers).toContain('target_room'); expect(retest.feasible).toBe(true);
});
it('does not use a future H4 candle to confirm a target pivot', () => {
  const step = 14400000, asOf = 5*step+6000;
  const h4 = [100,101,110,103,102,200].map((high,i) => ({timestamp:i*step, high,low:90,close:99}));
  const rows = Array.from({length:6},(_,i)=>({timestamp:asOf-6000-(6-i)*900000,high:100,low:98,close:99}));
  const input = {asOf,timeframe:'15m',candles:rows,structureCandles:h4,side:'long' as const,minSlFraction:.008,minRr:3};
  const a = observeEntryFeasibility(input);
  h4[5].high = 99999; h4[5].close = 99998;
  expect(observeEntryFeasibility(input)).toEqual(a);
  expect(a.status).toBe('geometry_feasible');
  expect(observeEntryFeasibility({...input,candles:[]} ).status).toBe('missing_data');
});
it('keeps simultaneous dispatch traces isolated across awaits', async () => {
  const a = createEntryTrace({lane:'a'},{}), b = createEntryTrace({lane:'b'},{});
  const seen = await Promise.all([a,b].map(t => withEntryTrace(t, async () => {
    await Promise.resolve(); return tracedEvent({stage:'provider'});
  })));
  expect(seen.map(x => x.trace_id)).toEqual([a.trace_id,b.trace_id]);
  expect(currentEntryTrace()).toBeUndefined();
});

it('reports historical provider requests as unlinked, never as zero calls', () => {
  const events = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/decision-997-events.json'),'utf8'));
  const r = auditEntryTraces(events.map((e: any) => ({event_type:e.type,event_data:e.data})));
  expect(r.unlinkedRequests).toBe(2); expect(r.traceCount).toBe(0); expect(r.unknownProviderCosts).toBe(2);
});
it('joins multiple provider attempts, admission and fill using persisted trace IDs', () => {
  const r=auditEntryTraces([
    {event_type:'llm_provider_request',event_data:{trace_id:'a',request_id:'r1'}},
    {event_type:'llm_provider_request',event_data:{trace_id:'a',request_id:'r2'}},
    {event_type:'entry_trace',event_data:{trace_id:'a',stage:'decision',decision_id:1}},
    {event_type:'pending_order_linked',event_data:{trace_id:'a',decision_id:1,order_id:'o1'}},
    {event_type:'entry_order_filled',event_data:{trace_id:'a',order_id:'o1'}},
  ]);
  expect(r.traces[0]).toMatchObject({requests:2,decisions:[1],orders:['o1'],fills:1});
  expect(r.unlinkedFills).toBe(0);
});
it('does not manufacture a retest comparison without the original measurement', () => {
  const m=observeEntryFeasibility({asOf:100,timeframe:'15m',candles:[],structureCandles:[],side:null,minSlFraction:.008,minRr:3});
  expect(compareRetestFeasibility(undefined,m).paired).toBe(false);
  expect(compareRetestFeasibility(m,m).paired).toBe(false);
});

it('joins reported usage once per request and retains unknown failed-attempt costs', () => {
  const r=auditEntryTraces([
    {event_type:'llm_provider_request',event_data:{trace_id:'a',request_id:'r1'}},
    {event_type:'llm_provider_result',event_data:{trace_id:'a',request_id:'r1',cost_usd:.003}},
    {event_type:'llm_provider_request',event_data:{trace_id:'a',request_id:'r2'}},
    {event_type:'llm_provider_result',event_data:{trace_id:'a',request_id:'r2',cost_usd:null}},
  ]);
  expect(r.knownProviderCostUsd).toBe(.003);expect(r.unknownProviderCosts).toBe(1);
});

it('does not credit a lower RR requirement as improvement from retest', () => {
  const m=observeEntryFeasibility({asOf:100,timeframe:'15m',candles:[],structureCandles:[],side:null,minSlFraction:.008,minRr:3});
  expect(compareRetestFeasibility(m,{...m,asOf:200,minRr:1.5})).toEqual({paired:false,reason:'policy_mismatch'});
});
