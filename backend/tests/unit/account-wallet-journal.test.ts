import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({find:vi.fn(),create:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetPosition:{findUnique:mocks.find},testnetTradeEvent:{create:mocks.create}}}));
import {persistAccountWalletObservation as persist} from '../../src/utils/account-wallet-journal';
describe('account wallet telemetry persistence',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('requires existing anchor and never creates a trading account or position',async()=>{
  mocks.find.mockResolvedValue(null);await expect(persist({account_id:2})).rejects.toThrow('anchor_missing');expect(mocks.create).not.toHaveBeenCalled();
 });
 it('retains actual observed account ID separate from pipeline anchor ownership',async()=>{
  mocks.find.mockResolvedValue({position_id:'pipeline_v3_kim_nghia'});mocks.create.mockResolvedValue({id:1});
  await persist({account_id:2,status:'applied'});
  const data=mocks.create.mock.calls[0][0].data;expect(data.event_type).toBe('account_wallet_sync_observed');expect(JSON.parse(data.event_data)).toEqual({account_id:2,status:'applied'});
 });
});
