import {AsyncLocalStorage} from 'node:async_hooks';
export type ProviderPurpose='dispatch'|'pending_review'|'opposite_flip'|'shadow'|'levels_repair'|'tp_repair'|'opportunity_review'|'post_exit'|'telegram';
const context=new AsyncLocalStorage<ProviderPurpose>();
export const withProviderPurpose=<T>(purpose:ProviderPurpose,fn:()=>T):T=>context.run(purpose,fn);
export const currentProviderPurpose=()=>context.getStore()??null;
