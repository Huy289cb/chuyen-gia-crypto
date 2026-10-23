import {describe,it,expect} from 'vitest';
import {buildIctContinuationCandidates,buildIctH1Structure,evaluateIctTargetEconomics,ictStructureAt,
  ictStructurePermits,selectIctResearchCandidates,type IctBar,type IctStructurePoint} from '../../src/utils/ict-research';

const hour=3600000,quarter=900000;
function fixture(){
  const h1:IctBar[]=Array.from({length:32},(_,i)=>({timestamp:i*hour,open:100,high:102,low:98,close:100,volume:10}));
  h1[2].high=150;h1[6].low=90;h1[9].high=110;h1[12].low=95;
  Object.assign(h1[15],{open:105,high:125,low:100,close:115});
  for(let i=16;i<h1.length;i++)Object.assign(h1[i],{open:115,high:117,low:113,close:115});
  const m15:IctBar[]=Array.from({length:20},(_,i)=>({timestamp:20*hour+i*quarter,open:100,high:102,low:98,close:100,volume:10}));
  m15[2].high=110;m15[5].low=94;m15[8].high=108;m15[11].low=96;
  Object.assign(m15[15],{open:100,high:121,low:99,close:120});
  Object.assign(m15[16],{open:118,high:121,low:116,close:119});
  return {'15m':m15,'1h':h1,'4h':[] as IctBar[]};
}
describe('ICT target economics',()=>{
  const input={side:'long' as const,entry:100000,target:100300,quantity:.001,feePerSide:.0005,slippageFraction:.002,fundingReserveUsd:0,aiCostUsd:0};
  it('rejects a TP which is profitable gross but loses after stress fees',()=>{
    expect(evaluateIctTargetEconomics(input)).toMatchObject({allowed:false,reason:'target_net_nonpositive'});
    expect(evaluateIctTargetEconomics({...input,target:100301}).allowed).toBe(true);
  });
  it('includes exit notional, side, funding reserve and AI exactly once',()=>{
    const r=evaluateIctTargetEconomics({...input,side:'short',target:99000,fundingReserveUsd:.05,aiCostUsd:.1});
    expect(r.netAtTargetUsd).toBeCloseTo(1-.0995-.2-.05-.1,10);
    expect(evaluateIctTargetEconomics({...input,side:'short'}).reason).toBe('invalid_economics');
  });
  it('fails closed for unknown or invalid costs',()=>{
    for(const patch of [{fundingReserveUsd:NaN},{aiCostUsd:-1},{quantity:0},{slippageFraction:Infinity}])
      expect(evaluateIctTargetEconomics({...input,...patch}).allowed).toBe(false);
  });
});
describe('causal H1 structure permission',()=>{
  it('waits for close-break, ignores wick invalidation and invalidates without waiting for new pivots',()=>{
    const rows=fixture()['1h'];const timeline=buildIctH1Structure(rows);
    expect(ictStructureAt(timeline,rows[15].timestamp)?.side).toBeNull();
    expect(ictStructureAt(timeline,rows[15].timestamp+hour-1)).toMatchObject({side:'long',protectedLevel:95,event:'bos'});
    const wick={timestamp:32*hour,open:115,high:116,low:90,close:115,volume:10};
    expect(buildIctH1Structure([...rows,wick]).at(-1)?.side).toBe('long');
    const broken={...wick,close:94};
    expect(buildIctH1Structure([...rows,broken]).at(-1)).toMatchObject({side:null,event:'protected_break'});
  });
  it('does not resurrect a pending plan after lost permission and rejects stale context',()=>{
    const p=(knownAt:number,side:'long'|null):IctStructurePoint=>({knownAt,side,protectedLevel:side?95:null,bosAt:0,referenceIndex:2,event:'unchanged'});
    const points=[p(0,'long'),p(hour,null),p(2*hour,'long')];
    expect(ictStructurePermits(points,'long',0,2*hour)).toBe(false);
    expect(ictStructureAt(points,4*hour)).toBeNull();
    expect(ictStructurePermits(points,'long',hour,0)).toBe(false);
  });
  it('is prefix invariant and validates chronological candles',()=>{
    const rows=fixture()['1h'];const full=buildIctH1Structure(rows);
    for(let n=5;n<=rows.length;n++)expect(buildIctH1Structure(rows.slice(0,n))).toEqual(full.slice(0,n));
    expect(()=>buildIctH1Structure([...rows.slice(0,5),...rows.slice(6)])).toThrow('invalid_ict_candle_series');
  });
});
describe('M15 continuation FVG',()=>{
  it('requires the third closed candle and targets known unswept liquidity',()=>{
    const data=fixture(),full=buildIctContinuationCandidates(data);
    expect(full).toHaveLength(1);expect(full[0]).toMatchObject({side:'long',entry:109,stopLoss:95.9,target:{price:125},setup:'ict_continuation_fvg'});
    expect(full[0].confirmedAt).toBe(data['15m'][16].timestamp+quarter-1);
    expect(full[0].target!.confirmedAt!).toBeLessThanOrEqual(full[0].confirmedAt);
    expect(buildIctContinuationCandidates({...data,'15m':data['15m'].slice(0,16)})).toEqual([]);
  });
  it('requires H1 permission, displacement and an unbroken protected M15 swing',()=>{
    const data=fixture();expect(buildIctContinuationCandidates({...data,'1h':[]})).toEqual([]);
    const weak=structuredClone(data);weak['15m'][15].open=119;
    expect(buildIctContinuationCandidates(weak)).toEqual([]);
    const invalid=structuredClone(data);invalid['15m'][15].low=95;
    expect(buildIctContinuationCandidates(invalid)).toEqual([]);
  });
  it('handles short geometry symmetrically',()=>{
    const original=fixture();const mirror=(b:IctBar):IctBar=>({...b,open:250-b.open,high:250-b.low,low:250-b.high,close:250-b.close});
    const rows=buildIctContinuationCandidates({'15m':original['15m'].map(mirror),'1h':original['1h'].map(mirror),'4h':[]});
    expect(rows).toHaveLength(1);expect(rows[0].side).toBe('short');expect(rows[0].entry).toBe(141);
    expect(rows[0].stopLoss).toBeGreaterThan(rows[0].entry);expect(rows[0].target!.price).toBeLessThan(rows[0].entry);
  });
  it('future bars cannot change already confirmed plans',()=>{
    const data=fixture(),full=buildIctContinuationCandidates(data);
    for(let n=16;n<=data['15m'].length;n++){
      const cutoff=data['15m'][n-1].timestamp+quarter;
      const prefix={'15m':data['15m'].slice(0,n),'1h':data['1h'].filter(b=>b.timestamp+hour<=cutoff),'4h':[]};
      expect(buildIctContinuationCandidates(prefix)).toEqual(full.filter(c=>c.confirmedAt<cutoff));
    }
  });
  it('does not consume an H1 target using its still-forming candle',()=>{
    const data=fixture();data['1h'][24].high=130;
    const c=buildIctContinuationCandidates(data)[0];
    expect(c.confirmedAt).toBeLessThan(25*hour-1);
    expect(c.target!.price).toBe(125);
  });
  it('combines lanes deterministically without mutating the inputs',()=>{
    const c=buildIctContinuationCandidates(fixture())[0],s={...c,id:'sweep-fixture'};
    expect(selectIctResearchCandidates('combined_cost_h1',[s],[c]).map(x=>x.id)).toEqual([s.id,c.id]);
    expect(selectIctResearchCandidates('continuation_cost_h1',[s],[c])).toEqual([c]);
  });
});
