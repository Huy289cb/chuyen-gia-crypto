import {beforeEach,it,expect,vi} from 'vitest';
import {currentProviderPurpose as current,withProviderPurpose as withPurpose} from '../../src/utils/provider-purpose-context';
const mocks=vi.hoisted(()=>({complete:vi.fn(),send:vi.fn(),jobs:[] as Array<()=>Promise<void>>,enabled:true,cancelled:false,client:true}));
vi.mock('../../src/lib/prisma',()=>({prisma:{}}));
vi.mock('../../src/config/telegram-ai',()=>({isTelegramAiEnabled:()=>mocks.enabled,isTelegramAdminUser:()=>true,telegramAiConfig:{model:'fixture',maxTokens:600,rateLimitPerUserHour:100,rateLimitPerChatDay:100}}));
vi.mock('../../src/services/groq-client',()=>({createGroqClient:()=>mocks.client?{completeText:mocks.complete}:null}));
vi.mock('../../src/services/telegram/ai-context.builder',()=>({buildAiContext:async()=>({meta:{generatedAt:'fixture-time'}}),contextToJson:()=> '{}',parseAiCommandArgs:()=>({action:'query',scope:'market',question:'fixture'}),redactSensitiveText:(s:string)=>s,splitMessageForTelegram:(s:string)=>[s]}));
vi.mock('../../src/services/telegram/ai-prompts',()=>({getConversationalGreeting:()=> 'greeting',getSystemPrompt:()=> 'system',getUserPrompt:()=> 'user',isConversationalScope:()=>false}));
vi.mock('../../src/services/telegram/ai-job-queue',()=>({cancelAiJobForChat:()=>false,isAiJobCancelled:()=>mocks.cancelled,enqueueAiJob:(_a:unknown,_b:unknown,_c:unknown,fn:()=>Promise<void>)=>{mocks.jobs.push(fn);return {ok:true};}}));
vi.mock('../../src/services/telegram/telegram-client',()=>({enqueueTelegramMessage:mocks.send}));
vi.mock('../../src/services/telegram/message-formatters',()=>({escapeHtml:(s:string)=>s}));
import {handleAiCommand,runTelegramAiQuery} from '../../src/services/telegram/telegram-ai.service';
beforeEach(()=>{vi.clearAllMocks();mocks.jobs.length=0;mocks.enabled=true;mocks.cancelled=false;mocks.client=true;});
it('labels direct query and preserves response plus parent context',async()=>{
 mocks.complete.mockImplementationOnce(async()=>{expect(current()).toBe('telegram');return 'answer';});
 await withPurpose('dispatch',async()=>{expect(await runTelegramAiQuery('market' as any)).toEqual({answer:'answer',scope:'market',generatedAt:'fixture-time'});expect(current()).toBe('dispatch');});
 expect(current()).toBeNull();expect(mocks.send).not.toHaveBeenCalled();expect(mocks.complete).toHaveBeenCalledExactlyOnceWith({systemPrompt:'system',userPrompt:'user',temperature:.3,maxTokens:600,preferredModels:['fixture']});
});
it('preserves original rejection and restores context on direct query failure',async()=>{
 const error=new Error('fixture network');mocks.complete.mockImplementationOnce(async()=>{expect(current()).toBe('telegram');throw error;});
 await withPurpose('shadow',async()=>{await expect(runTelegramAiQuery('market' as any)).rejects.toBe(error);expect(current()).toBe('shadow');});expect(current()).toBeNull();
});
it('labels the queued command when the queued callback actually executes',async()=>{
 mocks.complete.mockImplementationOnce(async()=>{expect(current()).toBe('telegram');return 'answer';});
 await handleAiCommand('fixture-chat',undefined,'fixture');expect(mocks.complete).not.toHaveBeenCalled();expect(mocks.jobs).toHaveLength(1);
 await withPurpose('pending_review',async()=>{await mocks.jobs[0]();expect(current()).toBe('pending_review');});expect(current()).toBeNull();expect(mocks.send).toHaveBeenCalledWith('answer','fixture-chat');
});
it('retains queued error handling and restores context on provider failure',async()=>{
 mocks.complete.mockImplementationOnce(async()=>{expect(current()).toBe('telegram');throw Error('fixture failure');});
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});try{await handleAiCommand('fixture-error',undefined,'fixture');await withPurpose('dispatch',async()=>{await mocks.jobs[0]();expect(current()).toBe('dispatch');});expect(mocks.send).toHaveBeenCalledWith(expect.stringContaining('fixture failure'),'fixture-error');expect(current()).toBeNull();}finally{log.mockRestore();}
});
it('skips provider when the queued job is cancelled',async()=>{
 await handleAiCommand('fixture-cancel',undefined,'fixture');mocks.cancelled=true;await mocks.jobs[0]();expect(mocks.complete).not.toHaveBeenCalled();
});
it('skips provider for missing client and disabled command',async()=>{
 mocks.client=false;await expect(runTelegramAiQuery('market' as any)).rejects.toThrow('Groq not configured');mocks.enabled=false;await handleAiCommand('fixture-disabled',undefined,'fixture');expect(mocks.jobs).toHaveLength(0);expect(mocks.complete).not.toHaveBeenCalled();
});
