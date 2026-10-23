import {describe,it,expect} from 'vitest';
import {buildIctSearchCandidates,isSilverWindow,oteEntry} from '../../src/utils/ict-ote-silver-research';
import type {IctBar} from '../../src/utils/ict-research';
const hour=3600000,quarter=900000;
function fixture(){
 const h1:IctBar[]=Array.from({length:32},(_,i)=>({timestamp:i*hour,open:100,high:102,low:98,close:100,volume:10}));
 h1[2].high=150;h1[6].low=90;h1[9].high=110;h1[12].low=95;
 Object.assign(h1[15],{open:105,high:125,low:100,close:115});
 for(let i=16;i<h1.length;i++)Object.assign(h1[i],{open:115,high:117,low:113,close:115});
 const m:IctBar[]=Array.from({length:20},(_,i)=>({timestamp:20*hour+i*quarter,open:100,high:102,low:98,close:100,volume:10}));
 m[2].high=110;m[5].low=94;m[8].high=108;m[11].low=96;
 Object.assign(m[15],{open:100,high:121,low:99,close:120});
 Object.assign(m[16],{open:118,high:121,low:116,close:119});
 return {'5m':[] as IctBar[],'15m':m,'1h':h1,'4h':[] as IctBar[]};
}
describe('OTE / Silver research',()=>{
 it('uses New York DST and excludes weekends and 11:00 boundary',()=>{
  for(const s of ['2025-01-06T15:00:00Z','2025-07-07T14:59:59Z'])expect(isSilverWindow(Date.parse(s))).toBe(true);
  for(const s of ['2025-01-06T14:59:59Z','2025-07-07T15:00:00Z','2025-07-06T14:30:00Z'])expect(isSilverWindow(Date.parse(s))).toBe(false);
 });
 it('mirrors deep retracement for long and short',()=>{expect(oteEntry(100,120)).toBe(105.9);expect(oteEntry(120,100)).toBe(114.1);});
 it('freezes OTE at BOS close without needing a future FVG',()=>{
  const ctx=fixture(),full=buildIctSearchCandidates(ctx,'ote');expect(full.length).toBe(1);
  expect(full[0]).toMatchObject({entry:103.4,stopLoss:95.9,target:{price:121},confirmedAt:24*hour-1});
  for(let n=15;n<=20;n++){
   const cutoff=ctx['15m'][n-1].timestamp+quarter;
   expect(buildIctSearchCandidates({...ctx,'15m':ctx['15m'].slice(0,n),'1h':ctx['1h'].filter(b=>b.timestamp+hour<=cutoff)},'ote')).toEqual(full.filter(c=>c.confirmedAt<cutoff));
  }
 });
 it('rejects gaps in input',()=>{const ctx=fixture();ctx['15m'].splice(5,1);expect(()=>buildIctSearchCandidates(ctx,'ote')).toThrow('invalid_ict_candle_series');});
});
