import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{$executeRaw:mocks.execute}}));
import {buildProviderJournalRecord as build} from '../../src/utils/provider-journal-record';
import {insertProviderJournalEvent as insert} from '../../src/repositories/provider-journal.repository';
const metadata={request_id:'fixture',provider:'example.invalid',model:'fixture-model',trace_id:null,provider_purpose:'telegram',cost_usd:null,cost_status:'unknown'};
it('whitelists evidence and retains missing cost and trace without fabricated defaults',()=>{
 const record=build('llm_provider_request',{...metadata,headers:{Authorization:'private'},messages:['private prompt'],response:'private response'});
 expect(record.metadata).toEqual(metadata);expect(JSON.stringify(record)).not.toContain('private');
});
it('rejects invalid identity and unsupported event types',()=>{
 expect(()=>build('other',metadata)).toThrow();for(const request_id of ['',null,{},'x'.repeat(513)])expect(()=>build('llm_provider_request',{...metadata,request_id})).toThrow();
});
it('rejects nonfinite, negative, nested quantities and reported cost without money',()=>{
 for(const cost_usd of [NaN,Infinity,-1,{}])expect(()=>build('llm_provider_result',{...metadata,cost_usd})).toThrow();
 expect(()=>build('llm_provider_result',{...metadata,cost_status:'reported'})).toThrow();
 expect(build('llm_provider_result',{...metadata,cost_usd:0,cost_status:'reported'}).metadata.cost_usd).toBe(0);
});
it('uses a parameterized independent insert and does not silently overwrite duplicate events',async()=>{
 mocks.execute.mockReset().mockResolvedValueOnce(1);await insert('llm_provider_request',metadata);
 const [sql,...args]=mocks.execute.mock.calls[0];expect(sql.join('?')).toContain('public.provider_request_journal');expect(sql.join('?')).not.toContain('ON CONFLICT');expect(args.slice(0,2)).toEqual(['fixture','llm_provider_request']);expect(JSON.parse(args[2])).toEqual(metadata);
 const error=new Error('fixture duplicate');mocks.execute.mockRejectedValueOnce(error);await expect(insert('llm_provider_request',metadata)).rejects.toBe(error);
});
it('does not confirm a zero-row insertion',async()=>{
 mocks.execute.mockReset().mockResolvedValueOnce(0);await expect(insert('llm_provider_result',metadata)).rejects.toThrow('provider_journal_insert_not_confirmed');
});
