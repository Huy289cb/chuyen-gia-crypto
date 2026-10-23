import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {postExitLesson,type PostExitResult} from './post-exit-analysis';
/** Match reconciled outcome and respect observation availability; stale revisions are not prompt evidence. */
export function measuredExitLesson(decisionId:number,net:number,exit:number,asOf=Date.now()):string|null {
 const root=resolve(process.env.POST_EXIT_DATA_DIR||resolve(__dirname,'../../data/post-exit'),'positions');
 try{
  for(const file of readdirSync(root).filter(f=>f.endsWith('.json'))){
   const row=JSON.parse(readFileSync(join(root,file),'utf8')) as {decisionId:number;recordedAt:number;result:PostExitResult};
   if(row.decisionId!==decisionId||row.recordedAt>asOf||Math.abs(row.result.position.net-net)>1e-8||Math.abs(row.result.position.exit-exit)>1e-8)continue;
   return postExitLesson(row.result,asOf);
  }
 }catch{ /* Missing observations never block trading. */ }
 return null;
}
