import type { AiContextScope } from './ai-context.builder';
export declare function isConversationalScope(scope: AiContextScope): boolean;
export declare function getSystemPrompt(scope: AiContextScope): string;
export declare function getUserPrompt(scope: AiContextScope, contextJson: string, question?: string, sessionHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
}>): string;
export declare function getConversationalGreeting(): string;
//# sourceMappingURL=ai-prompts.d.ts.map