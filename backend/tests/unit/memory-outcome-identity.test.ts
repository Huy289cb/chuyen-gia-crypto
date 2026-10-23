import {it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({lookup:vi.fn(async()=>({symbol:'BTC'})),store:vi.fn(async(x)=>x)}));
vi.mock('../../src/repositories/memory.repository',()=>({getTradeOutcomeById:m.lookup,storeTradeReflection:m.store}));
vi.mock('../../src/repositories/trade.repository',()=>({}));
vi.mock('../../src/utils/entry-trace',()=>({currentEntryTrace:vi.fn(),recordEntryStage:vi.fn()}));
import {MemoryService} from '../../src/services/memory.service';
it('looks up the outcome primary key rather than an unrelated decision ID',async()=>{
 const service=new MemoryService();await service.generateReflection(42,'loss',-.5);expect(m.lookup).toHaveBeenCalledWith(42);expect(m.store).toHaveBeenCalledWith(expect.objectContaining({symbol:'BTC',outcome_id:42}));
});
