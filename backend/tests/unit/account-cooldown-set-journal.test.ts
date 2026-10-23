import {beforeEach,it,expect,vi} from 'vitest';
const update=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
const journal=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetAccount:{update}}}));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:journal}));
import {replayRecordedAccountCooldownSet as replay} from '../../src/utils/recorded-account-cooldown-set';
import {setTestnetAccountCooldown} from '../../src/repositories/testnet.repository';
beforeEach(()=>{vi.clearAllMocks();});
it('records exact successful setter write with DB return clock and no invented previous state',async()=>{
 const until=new Date(Date.now()+3600000);await setTestnetAccountCooldown(1,until);
 expect(update).toHaveBeenCalledWith({where:{id:1},data:{cooldown_until:until}});
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 const [e,type]=journal.mock.calls[0];expect(type).toBe('account_cooldown_set_applied');
 expect(e).toMatchObject({schema:'account-cooldown-set-v1',account_id:1,input:{cooldown_until:until.toISOString()},update:{cooldown_until:until.toISOString()},applied_clock_source:'db_update_return'});
 expect(Date.parse(e.applied_at)).toBeGreaterThanOrEqual(Date.parse(e.write_started_at));
 expect(e).not.toHaveProperty('previous_cooldown');
 expect(replay(e,Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true});
});
it('does not issue applied journal on DB failure',async()=>{
 update.mockRejectedValueOnce(new Error('DB failed'));await expect(setTestnetAccountCooldown(1,new Date())).rejects.toThrow('DB failed');expect(journal).not.toHaveBeenCalled();
});
it('returns while persistence is pending',async()=>{
 journal.mockImplementationOnce(()=>new Promise(()=>{}));await setTestnetAccountCooldown(1,new Date());expect(update).toHaveBeenCalledTimes(1);
});

it('keeps invalid Date reaching the existing DB operation and replay unknown',async()=>{
 const until=new Date('invalid');await setTestnetAccountCooldown(1,until);
 expect(update.mock.calls[0][0].data.cooldown_until).toBe(until);
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 expect(replay(journal.mock.calls[0][0],Date.now(),Date.now()+100)).toMatchObject({status:'unknown'});
});
