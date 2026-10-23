import { type AiContextScope } from './ai-context.builder';
export declare function handleAiCommand(chatId: string, userId: string | undefined, args: string): Promise<void>;
export declare function runTelegramAiQuery(scope: AiContextScope, question?: string): Promise<{
    answer: string;
    scope: AiContextScope;
    generatedAt: string;
}>;
export declare function handleLogsCommand(chatId: string, userId: string | undefined): Promise<void>;
export declare function handleDeployHelpCommand(chatId: string): void;
//# sourceMappingURL=telegram-ai.service.d.ts.map