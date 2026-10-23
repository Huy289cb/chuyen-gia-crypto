import {it,expect} from 'vitest';
import {buildProviderCostJournal} from '../../src/utils/provider-cost-journal';
const start=(id:string)=>({event_type:'llm_provider_request',event_data:{request_id:id,trace_id:'t',provider:'p',model:'m',provider_purpose:'dispatch'}});
const event=(id:string,cost:unknown,status='reported')=>({event_type:'llm_provider_result',event_data:{request_id:id,trace_id:'t',provider:'p',model:'m',provider_purpose:'dispatch',cost_usd:cost,cost_status:status}});
it('sums reported costs including retries and preserves zero only when explicitly reported',()=>{
 const result=buildProviderCostJournal([start('a'),event('a',.01),start('b'),event('b',0)]);
 expect(result.recordedSubtotalUsd).toBe(.01);expect(result.totalCostUsd).toBeNull();expect(result.requests).toHaveLength(2);
});
it('keeps incomplete cost total unknown and avoids double counting duplicate results',()=>{
 const result=buildProviderCostJournal([event('a',.01),event('a',.01),event('b',null,'unknown'),{event_type:'llm_provider_request',event_data:{request_id:'c'}}]);
 expect(result.totalCostUsd).toBeNull();expect(result.unknownRequests).toBe(3);expect(result.knownSubtotalUsd).toBe(0);
});

it('does not treat an empty event export as zero cost or complete request coverage',()=>{
 expect(buildProviderCostJournal([])).toMatchObject({knownSubtotalUsd:0,recordedSubtotalUsd:null,totalCostUsd:null,request_coverage:'not_established'});
});
it('keeps an overflowing reported subtotal unknown',()=>{
 expect(buildProviderCostJournal([start('a'),event('a',Number.MAX_VALUE),start('b'),event('b',Number.MAX_VALUE)]).recordedSubtotalUsd).toBeNull();
});

it('keeps orphan, duplicated request and mismatched trace pairs incomplete',()=>{
 for(const events of [[event('a',.01)],[start('a'),start('a'),event('a',.01)],[start('a'),{...event('a',.01),event_data:{...event('a',.01).event_data,trace_id:'other'}}]]){
  expect(buildProviderCostJournal(events)).toMatchObject({incompletePairs:1,recordedSubtotalUsd:null,totalCostUsd:null,knownSubtotalUsd:.01});
 }
});

it('does not attribute reported money to mismatched, missing or unsupported purposes',()=>{
 for(const purpose of ['shadow',null,'invented']){
  const result=buildProviderCostJournal([start('a'),{...event('a',.01),event_data:{...event('a',.01).event_data,provider_purpose:purpose}}]);
  expect(result).toMatchObject({incompletePairs:1,knownSubtotalUsd:.01,recordedSubtotalUsd:null,totalCostUsd:null});
  expect(result.requests[0].provider_purpose).toBeNull();
 }
 const unsupportedStart={...start('a'),event_data:{...start('a').event_data,provider_purpose:'invented'}};
 const unsupportedResult={...event('a',.01),event_data:{...event('a',.01).event_data,provider_purpose:'invented'}};
 expect(buildProviderCostJournal([unsupportedStart,unsupportedResult]).incompletePairs).toBe(1);
 const legacyStart={...start('a'),event_data:{...start('a').event_data,provider_purpose:undefined}};
 const legacyResult={...event('a',.01),event_data:{...event('a',.01).event_data,provider_purpose:undefined}};
 expect(buildProviderCostJournal([legacyStart,legacyResult]).incompletePairs).toBe(1);
});
it('retains a matched purpose while keeping whole-system coverage unproven',()=>{
 const result=buildProviderCostJournal([start('a'),event('a',.01)]);
 expect(result.requests[0]).toMatchObject({provider_purpose:'dispatch',pair_status:'matched',cost_usd:.01});
 expect(result).toMatchObject({recordedSubtotalUsd:.01,totalCostUsd:null,request_coverage:'not_established'});
});

it('accounts for explicitly untraced auxiliary calls without inventing trade attribution',()=>{
 const result=buildProviderCostJournal([ {...start('a'),event_data:{...start('a').event_data,trace_id:null,provider_purpose:'telegram'}}, {...event('a',.01),event_data:{...event('a',.01).event_data,trace_id:null,provider_purpose:'telegram'}} ]);
 expect(result).toMatchObject({incompletePairs:0,recordedSubtotalUsd:.01,totalCostUsd:null,request_coverage:'not_established'});
 expect(result.requests[0]).toMatchObject({trace_id:null,provider_purpose:'telegram',trade_attribution:'not_established',pair_status:'matched'});
 const missing=buildProviderCostJournal([ {...start('a'),event_data:{...start('a').event_data,trace_id:undefined}}, {...event('a',.01),event_data:{...event('a',.01).event_data,trace_id:undefined}} ]);
 expect(missing.incompletePairs).toBe(1);
});
