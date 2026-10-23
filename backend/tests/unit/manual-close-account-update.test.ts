import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildManualCloseAccountUpdate as build} from '../../src/utils/manual-close-account-update';
const deployed=readFileSync('dist/routes/testnet.js','utf8');
const route=deployed.slice(deployed.indexOf("router.post('/positions/:id/close'"),deployed.indexOf("router.get('/pending-orders'"));
const start=route.indexOf('data: {',route.indexOf('await prismaClient.testnetAccount.update'));
const end=route.indexOf('\n            },',start);
if(start<0||end<0)throw Error('deployed manual update not found');
const expression=route.slice(start+6,end)+'\n}';
const legacy=new Function('position','realizedPnl','isWin','Date','return ('+expression+');');
it('matches deployed manual update including zero and subcent PnL',()=>{
 const at=new Date('2026-10-03T00:00:00Z');class Clock extends Date{constructor(){super(at);}}
 for(const pnl of [-10,-0.01,-0.001,0,0.001,0.01,10]){
  expect(JSON.parse(JSON.stringify(build({balance:30,realizedPnl:pnl,lastTradeTime:at,updatedAt:at})))).toEqual(JSON.parse(JSON.stringify(legacy({account:{current_balance:30}},pnl,pnl>0,Clock))));
 }
});
it('keeps manual zero-PnL loss counting distinct from automatic threshold',()=>{
 expect(build({balance:30,realizedPnl:0,lastTradeTime:new Date(),updatedAt:new Date()})).toMatchObject({losing_trades:{increment:1},consecutive_losses:{increment:1},realized_pnl:{increment:0}});
});
