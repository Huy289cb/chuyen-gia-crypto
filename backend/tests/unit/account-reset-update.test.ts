import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildAccountResetUpdate as build} from '../../src/utils/account-reset-update';
const deployed=readFileSync('dist/routes/testnet.js','utf8');const route=deployed.slice(deployed.indexOf("router.post('/reset/:accountId'"),deployed.indexOf("router.get('/sync/:accountId'"));
const a=route.indexOf('data: {',route.indexOf('prismaClient.testnetAccount.update'));
const b=route.indexOf('\n                },',a);if(a<0||b<0)throw Error('reset region absent');
const legacy=new Function('account','Date','return ('+route.slice(a+6,b)+'\n});');
it('matches the exact deployed reset assignments and does not reset unrelated fields',()=>{
 const at=new Date('2026-10-03T00:00:00Z');class Clock extends Date{constructor(){super(at);}}
 for(const balance of [0,30,100.25])expect(JSON.parse(JSON.stringify(build(balance,at)))).toEqual(JSON.parse(JSON.stringify(legacy({starting_balance:balance},Clock))));
 expect(build(30,at)).not.toHaveProperty('precision_error_count');expect(build(30,at)).not.toHaveProperty('accumulated_trading_fees');
});
