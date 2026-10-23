import {describe,it,expect} from 'vitest';
import {buildDailyExpansionCandidates,expansionH4Structure,expansionH4Permits} from '../../src/utils/daily-expansion-research';
import type {IctBar} from '../../src/utils/ict-research';
const h=3600000;
function fixture(){
 const rows:IctBar[]=Array.from({length:32},(_,i)=>({timestamp:i*h,open:100,high:101,low:99,close:100,volume:1}));
 rows[2].high=110;rows[3].low=90;
 for(let i=24;i<32;i++)Object.assign(rows[i],{open:112,high:113,low:111,close:112});
 Object.assign(rows[24],{open:109,high:113,low:109,close:112});
 return {'1h':rows,'4h':[] as IctBar[]};
}
describe('daily expansion research',()=>{
 it('freezes previous-day range and waits for closed H1 breakout',()=>{
  const ctx=fixture(),full=buildDailyExpansionCandidates(ctx,false);expect(full).toHaveLength(1);
  expect(full[0]).toMatchObject({entry:110,stopLoss:108.9,target:{price:130},confirmedAt:25*h-1});
  for(let n=23;n<=32;n++)expect(buildDailyExpansionCandidates({...ctx,'1h':ctx['1h'].slice(0,n)},false)).toEqual(full.filter(c=>c.confirmedAt<n*h));
 });
 it('mirrors shorts and rejects missing H4 permission',()=>{
  const ctx=fixture();expect(buildDailyExpansionCandidates(ctx,true)).toHaveLength(0);
  ctx['1h']=ctx['1h'].map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  expect(buildDailyExpansionCandidates(ctx,false)[0]).toMatchObject({side:'short',entry:90,target:{price:70}});
 });
 it('rejects incomplete previous day and consumed measured target',()=>{
  const ctx=fixture();ctx['1h'].shift();expect(buildDailyExpansionCandidates(ctx,false)).toHaveLength(0);
  const ctx2=fixture();ctx2['1h'][24].high=131;expect(buildDailyExpansionCandidates(ctx2,false)).toHaveLength(0);
 });
 it('maps H4 close timestamps causally and fails closed on stale permission',()=>{
  const rows=fixture()['1h'].map(b=>({...b,timestamp:b.timestamp*4})),points=expansionH4Structure(rows);
  for(let n=5;n<=rows.length;n++)expect(expansionH4Structure(rows.slice(0,n))).toEqual(points.slice(0,n));
  expect(expansionH4Permits(points,'long',rows.at(-1)!.timestamp+9*h,rows.at(-1)!.timestamp+9*h)).toBe(false);
 });
});
