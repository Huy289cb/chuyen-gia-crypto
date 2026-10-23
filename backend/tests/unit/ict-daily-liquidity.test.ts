import {describe,it,expect} from 'vitest';
import {buildDailyLiquidityCandidates,DAILY_VARIANTS} from '../../src/utils/ict-daily-liquidity-research';
import type {IctBar} from '../../src/utils/ict-research';
const step=900000;
function fixture(){
 const rows:IctBar[]=Array.from({length:120},(_,i)=>({timestamp:i*step,open:100,high:101,low:99,close:100,volume:1}));
 rows[2].high=110;rows[3].low=90;
 for(let i=96;i<120;i++)Object.assign(rows[i],{open:92,high:93,low:91,close:92});
 Object.assign(rows[96],{open:92,high:93,low:89,close:92});
 return {'15m':rows,'1h':[] as IctBar[],'4h':[] as IctBar[]};
}
describe('previous UTC day liquidity research',()=>{
 it('uses complete previous day, confirms after close, deduplicates sweeps',()=>{
  const ctx=fixture();const c=buildDailyLiquidityCandidates(ctx,'daily_reclaim_mid');
  expect(c).toHaveLength(1);expect(c[0]).toMatchObject({side:'long',confirmedAt:97*step-1,entry:90,stopLoss:88.9,target:{price:100}});
  ctx['15m'].shift();expect(buildDailyLiquidityCandidates(ctx,'daily_reclaim_mid')).toHaveLength(0);
 });
 it('mirrors long and short without changing target geometry',()=>{
  const ctx=fixture();ctx['15m']=ctx['15m'].map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  expect(buildDailyLiquidityCandidates(ctx,'daily_reclaim_far')[0]).toMatchObject({side:'short',entry:110,target:{price:90}});
 });
 it('does not resurrect a target hit during the sweep, or the opposite edge hit earlier that day',()=>{
  const ctx=fixture();ctx['15m'][96].high=101;expect(buildDailyLiquidityCandidates(ctx,'daily_reclaim_mid')).toHaveLength(0);
  const c=fixture();Object.assign(c['15m'][96],{open:108,high:111,low:107,close:111});
  Object.assign(c['15m'][97],{open:92,high:93,low:89,close:92});
  expect(buildDailyLiquidityCandidates(c,'daily_reclaim_far')).toHaveLength(0);
 });
 it('requires MSS and third closed candle for FVG, with prefix invariance',()=>{
  const ctx=fixture();ctx['15m'][96].low=91;ctx['15m'][100].high=97;
  Object.assign(ctx['15m'][110],{open:92,high:93,low:89,close:91});
  Object.assign(ctx['15m'][111],{open:92,high:93,low:90,close:91});
  Object.assign(ctx['15m'][112],{open:91,high:99.5,low:90.5,close:99});
  Object.assign(ctx['15m'][113],{open:99,high:99.6,low:98,close:99.2});
  const c=buildDailyLiquidityCandidates(ctx,'daily_mss_mid');expect(c).toHaveLength(1);
  expect(c[0]).toMatchObject({entry:95.5,confirmedAt:114*step-1,target:{price:100}});
  for(const variant of DAILY_VARIANTS){const full=buildDailyLiquidityCandidates(ctx,variant);
   for(let n=95;n<=120;n++)expect(buildDailyLiquidityCandidates({...ctx,'15m':ctx['15m'].slice(0,n)},variant)).toEqual(full.filter(c=>c.confirmedAt<n*step));
  }
 });
 it('rejects malformed candle history',()=>{const ctx=fixture();ctx['15m'].splice(50,1);expect(()=>buildDailyLiquidityCandidates(ctx,'daily_reclaim_far')).toThrow('invalid_ict_candle_series');});
});
