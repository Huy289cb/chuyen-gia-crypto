'use strict';
const {performance}=require('node:perf_hooks');const production=require('./production-portfolio-runtime.cjs');
// Timings only: preserve original arguments, results, exceptions and SQL transactions.
function createProductionPortfolioRuntime(options){
 const queries=new Map(),commands=[],journals=new Map();
 const measured=(label,fn,args,stats)=>{const t=performance.now();const record=()=>{const elapsed=performance.now()-t;const s=stats.get(label)||{count:0,total_ms:0,max_ms:0};s.count++;s.total_ms+=elapsed;s.max_ms=Math.max(s.max_ms,elapsed);stats.set(label,s);};let value;try{value=fn(...args);}catch(e){record();throw e;}if(value&&typeof value.then==='function')return value.then(v=>{record();return v;},e=>{record();throw e;});record();return value;};
 const wrap=db=>new Proxy(db,{get(target,key){const value=target[key];if(key==='$transaction')return (...args)=>{if(typeof args[0]==='function'){const callback=args[0];args[0]=tx=>callback(wrap(tx));}return measured('db.$transaction',value.bind(target),args,queries);};if(typeof value==='function')return(...args)=>measured('db.'+String(key),value.bind(target),args,queries);if(value&&typeof value==='object'&&typeof value.findMany==='function')return new Proxy(value,{get(model,method){const f=model[method];return typeof f==='function'?(...args)=>measured(String(key)+'.'+String(method),f.bind(model),args,queries):f;}});return value;}});
 const journal=options.commandJournal&&new Proxy(options.commandJournal,{get(target,key){const fn=target[key];return typeof fn==='function'?(...args)=>measured('journal.'+String(key),fn.bind(target),args,journals):fn;}});
 const runtime=production.createProductionPortfolioRuntime({...options,database:wrap(options.database),commandJournal:journal});
 return {...runtime,step:async command=>{const t=performance.now();try{return await runtime.step(command);}finally{commands.push({kind:command.kind,at:command.at,wall_ms:performance.now()-t});}},diagnostics:()=>({...runtime.diagnostics(),wall_profile:{scope:'overlapping timings; transaction/journal/query totals must not be summed',commands,queries:Object.fromEntries(queries),journal:Object.fromEntries(journals)}})};
}
module.exports={createProductionPortfolioRuntime};
