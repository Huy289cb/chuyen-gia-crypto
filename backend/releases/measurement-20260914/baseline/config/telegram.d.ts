export type TelegramNotifyLevel = 'off' | 'trades_only' | 'trades_risk' | 'verbose';
export interface TelegramConfig {
    enabled: boolean;
    /** When false: sendMessage/notify only — no getUpdates (frees queue for manual debug). */
    pollingEnabled: boolean;
    botToken: string;
    chatIds: string[];
    allowedUserIds: string[];
    notifyLevel: TelegramNotifyLevel;
    dailyReportCron: string;
    timezone: string;
}
export declare const telegramConfig: TelegramConfig;
export declare function isTelegramEnabled(): boolean;
export declare function isTelegramPollingEnabled(): boolean;
/** Log once per process for ops/debug (pid + role). */
export declare function logTelegramProcessContext(role: string): void;
export declare function shouldNotifyVerbose(): boolean;
export declare function shouldNotifyTrades(): boolean;
export declare function shouldNotifyRisk(): boolean;
export declare function validateTelegramConfig(): void;
export declare function isChatAllowed(chatId: string | number): boolean;
export declare function isUserAllowed(userId: string | number | undefined): boolean;
//# sourceMappingURL=telegram.d.ts.map