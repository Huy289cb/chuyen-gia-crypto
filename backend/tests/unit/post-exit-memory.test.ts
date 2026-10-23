import {it,expect,afterEach,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {measuredExitLesson} from '../../src/utils/post-exit-memory';
import {analyzePostExit} from '../../src/utils/post-exit-analysis';
const dirs:string[]=[];afterEach(()=>{vi.unstubAllEnvs();dirs.forEach(d=>rmSync(d,{recursive:true,force:true}));});
it('rejects future and reconciled-stale observations and matches exact decision ID',()=>{
 const dir=mkdtempSync(join(tmpdir(),'exit-memory-'));dirs.push(dir);mkdirSync(join(dir,'positions'));vi.stubEnv('POST_EXIT_DATA_DIR',dir);
 const result=analyzePostExit({id:'p',side:'long',entry:100,initialStop:90,target:115,entryTime:0,exitTime:60000,exit:90,quantity:1,net:-11,costs:1},[{openTime:0,open:100,high:100,low:90,close:90}],60000);
 writeFileSync(join(dir,'positions/p.json'),JSON.stringify({decisionId:123,recordedAt:60001,result}));
 expect(measuredExitLesson(123,-11,90,60000)).toBeNull();expect(measuredExitLesson(123,-12,90,60002)).toBeNull();expect(measuredExitLesson(123,-11,91,60002)).toBeNull();expect(measuredExitLesson(124,-11,90,60002)).toBeNull();expect(measuredExitLesson(123,-11,90,60002)).toContain('pre-exit MFE');
});
