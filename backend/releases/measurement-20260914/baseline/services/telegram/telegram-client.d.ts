export interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        text?: string;
        caption?: string;
        photo?: Array<{
            file_id: string;
        }>;
        chat: {
            id: number;
            type: string;
        };
        from?: {
            id: number;
            username?: string;
            first_name?: string;
        };
    };
}
export declare function sendTelegramMessage(text: string, chatId?: string, options?: {
    plainText?: boolean;
}): Promise<boolean>;
export declare function enqueueTelegramMessage(text: string, chatId?: string, options?: {
    plainText?: boolean;
}): void;
export declare function getTelegramUpdates(offset?: number, timeoutSeconds?: number): Promise<TelegramUpdate[]>;
/** Clear webhook so getUpdates/polling can receive messages. */
export declare function deleteTelegramWebhook(): Promise<void>;
//# sourceMappingURL=telegram-client.d.ts.map