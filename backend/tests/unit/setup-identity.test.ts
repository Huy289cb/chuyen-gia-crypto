import { describe, it, expect } from 'vitest';
import { identifyAnchoredSetup } from '../../src/utils/setup-identity';
import { analyzeBreakoutVolume } from '../../src/analyzers/breakout-volume.analyzer';
import { analyzeLiquiditySweep } from '../../src/analyzers/liquidity-sweep.analyzer';
const input = {symbol:'BTCUSDT',timeframe:'5m',playbook:'breakout_volume',side:'long',detected:true,asOf:3_000_000,graceMs:5_000,
 metrics:{detectorVersion:'breakout_volume_v1',anchorHighOpenTime:0,anchorLowOpenTime:300_000,anchorWindowEndOpenTime:900_000,detectionOpenTime:1_200_000}};
describe('setup anchor identity measurement',()=>{
 it('deduplicates repeated detections on same range and keeps cross-frame wave unknown',()=>{
  const first=identifyAnchoredSetup(input),repeat=identifyAnchoredSetup({...input,metrics:{...input.metrics,anchorWindowEndOpenTime:1_200_000,detectionOpenTime:1_500_000}});
  expect(first.status).toBe('known');expect(first.setup_id).toBe(repeat.setup_id);expect(first.wave_id).toBeNull();
  expect(first.anchor_known_at).toBe(1_205_000);expect(first.detection_known_at).toBe(1_505_000);
  expect(identifyAnchoredSetup({...input,timeframe:'15m'}).setup_id).not.toBe(first.setup_id);
 });
 it('separates changed anchors and direction',()=>{
  const id=identifyAnchoredSetup(input).setup_id;
  expect(identifyAnchoredSetup({...input,side:'short'}).setup_id).not.toBe(id);
  expect(identifyAnchoredSetup({...input,metrics:{...input.metrics,anchorHighOpenTime:600_000}}).setup_id).not.toBe(id);
 });
 it.each([
  {asOf:1_504_999},{timeframe:'2m'},{detected:false},{side:null},
  {metrics:{...input.metrics,anchorHighOpenTime:null}},
  {metrics:{...input.metrics,anchorWindowEndOpenTime:1_200_000}},
  {metrics:{...input.metrics,detectorVersion:'legacy'}},
 ])('fails closed on missing or future evidence %j',patch=>{
  const result=identifyAnchoredSetup({...input,...patch});expect(result.status).toBe('unknown');expect(result.setup_id).toBeNull();
 });
 it('extracts first tied extrema timestamps from the actual detection window',()=>{
  const candles=Array.from({length:30},(_,i)=>({timestamp:i*300_000,open:100,close:100,high:102,low:98,volume:1}));
  candles[29]={...candles[29],close:110,high:111,volume:3};
  const breakout=analyzeBreakoutVolume(candles);
  expect(breakout.detected).toBe(true);expect(breakout.evidence.metrics.anchorHighOpenTime).toBe(0);
  expect(breakout.evidence.metrics.anchorWindowEndOpenTime).toBe(24*300_000);
  const sweep=analyzeLiquiditySweep(candles);
  expect(sweep.evidence.metrics.anchorHighOpenTime).toBe(10*300_000);
  expect(sweep.evidence.metrics.detectionOpenTime).toBe(29*300_000);
 });
});
it('exports measured structural prices for wave association without changing the stable setup key',()=>{
 const legacy=identifyAnchoredSetup(input);
 const measured=identifyAnchoredSetup({...input,metrics:{...input.metrics,resistance:110,support:90}});
 expect(measured.setup_id).toBe(legacy.setup_id);
 expect(measured.anchor_evidence).toEqual({symbol:'BTCUSDT',side:'long',timeframe:'5m',high:110,low:90,high_open:0,low_open:300000});
});
