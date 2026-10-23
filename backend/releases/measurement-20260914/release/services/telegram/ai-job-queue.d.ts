export interface AiJobPayload {
    id: string;
    chatId: string;
    userId?: string;
    scope: string;
    run: () => Promise<void>;
}
export declare function cancelAiJobForChat(chatId: string): boolean;
export declare function isAiJobCancelled(chatId: string): boolean;
export declare function clearAiJobCancellation(chatId: string): void;
export declare function hasActiveAiJob(chatId: string): boolean;
export declare function enqueueAiJob(chatId: string, userId: string | undefined, scope: string, run: () => Promise<void>): {
    ok: true;
    jobId: string;
} | {
    ok: false;
    reason: 'busy';
};
//# sourceMappingURL=ai-job-queue.d.ts.map