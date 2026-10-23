export interface TelegramAiConfig {
    enabled: boolean;
    model: string;
    maxTokens: number;
    rateLimitPerUserHour: number;
    rateLimitPerChatDay: number;
    /** Production: true when AI enabled — requires TELEGRAM_ALLOWED_USER_IDS */
    requireAllowedUserIds: boolean;
    systemPromptVersion: string;
}
export interface CursorAgentConfig {
    enabled: boolean;
    apiKey: string;
    model: string;
    repoUrl: string;
    baseBranch: string;
}
export interface CursorChatConfig {
    enabled: boolean;
    model: string;
    adminOnly: boolean;
    rateLimitPerUserHour: number;
    sessionTtlMs: number;
    jobTimeoutMs: number;
}
export declare const telegramAiConfig: TelegramAiConfig;
export declare const cursorAgentConfig: CursorAgentConfig;
export declare const cursorChatConfig: CursorChatConfig;
export declare function isTelegramAiEnabled(): boolean;
export declare function isCursorAgentEnabled(): boolean;
export declare function isCursorChatEnabled(): boolean;
export declare function canUseCursorChat(userId: string | number | undefined): boolean;
export declare function validateTelegramAiConfig(): void;
export declare function validateCursorAgentConfig(): void;
/** Admin-only commands (/logs): user must be in TELEGRAM_ALLOWED_USER_IDS when list is set. */
export declare function isTelegramAdminUser(userId: string | number | undefined): boolean;
//# sourceMappingURL=telegram-ai.d.ts.map