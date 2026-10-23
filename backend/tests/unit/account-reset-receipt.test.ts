import {it,expect} from 'vitest';
import {buildAccountResetReceipt as build} from '../../src/utils/account-reset-receipt';
const id='00000000-0000-4000-8000-000000000001',at=new Date('2026-10-03T00:00:00Z');
it('records local assignments and deleted scope without claiming exchange or commit time',()=>{
 expect(build(1,id,30,at)).toMatchObject({input:{starting_balance:30},update:{current_balance:30,max_drawdown:0},clock_basis:'transaction_insert_not_commit',exchange_flatness_verified:false,economic_initial_capital:null});
 expect(build(1,id,30,at)).not.toHaveProperty('applied_at');
});
it('rejects nonfinite and malformed receipt identities',()=>{for(const f of [()=>build(0,id,30,at),()=>build(1,'invalid',30,at),()=>build(1,id,Infinity,at),()=>build(1,id,30,new Date(NaN))])expect(f).toThrow('invalid_reset_receipt_input');});
