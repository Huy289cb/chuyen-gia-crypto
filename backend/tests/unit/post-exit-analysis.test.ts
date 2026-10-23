import {describe,it,expect} from 'vitest';
import {analyzePostExit,postExitLesson, type ObservedTrade} from '../../src/utils/post-exit-analysis';
const p:ObservedTrade={id:'x',side:'long',entry:100,initialStop:90,target:115,entryTime:0,exitTime:120000,exit:90,quantity:1,net:-11,costs:1};
const bars=Array.from({length:4350},(_,i)=>({openTime:i*60000,open:100,high:i<2?104:116,low:i<2?95:89,close:100}));
describe('post-exit evidence',()=>{
 it('separates pre-close from post-close moves and maintains original R',()=>{
  const r=analyzePostExit(p,bars,74*3600000);expect(r.during.mfeR).toBe(.4);expect(r.during.maeR).toBe(.5);
  expect(r.after[0].reachOriginalTargetAt).toBe(120000);expect(r.after[0].mfeR).toBe(2.6);expect(r.after.every(w=>w.status==='complete')).toBe(true);
 });
 it('does not use partial boundary minutes or future data',()=>{
  const r=analyzePostExit({...p,entryTime:1,exitTime:120001},bars,180000);expect(r.during.bars).toBe(1);expect(r.after[0].bars).toBe(0);expect(r.after[0].status).toBe('pending');expect(postExitLesson(r,179999)).toBeNull();
 });
 it('marks missing minutes incomplete, including fully elapsed horizons',()=>{
  const r=analyzePostExit(p,bars.filter(b=>b.openTime!==180000),74*3600000);expect(r.after.every(w=>w.status==='incomplete')).toBe(true);
 });
 it('handles short direction and costs correctly',()=>{
  const r=analyzePostExit({...p,side:'short',initialStop:110,target:85,exit:110},bars,74*3600000);expect(r.during.mfeR).toBe(.5);expect(r.after[0].reachOriginalTargetAt).toBeNull();expect(r.after[0].recoverIncurredCostsAt).toBe(120000);
 });
 it('rejects invalid original geometry and duplicate bars',()=>{
  expect(()=>analyzePostExit({...p,initialStop:101},bars,74*3600000)).toThrow();expect(()=>analyzePostExit(p,[bars[0],bars[0]],74*3600000)).toThrow();
 });
 it('does not mistake staying above entry after TP for revisiting entry',()=>{
  const above=bars.map(b=>({...b,open:116,high:118,low:114,close:116}));
  const r=analyzePostExit({...p,exit:115,net:14},above,74*3600000);
  expect(r.after[0].returnToEntryAt).toBeNull();expect(r.after[0].reachOriginalTargetAt).toBe(120000);
 });
 it('revised close time changes observation origin',()=>{
  const a=analyzePostExit(p,bars,74*3600000),b=analyzePostExit({...p,exitTime:240000},bars,74*3600000);expect(a.after[0].start).not.toBe(b.after[0].start);
 });
});
