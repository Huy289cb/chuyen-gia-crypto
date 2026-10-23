export interface CursorJobPayload {
    id: string;
    chatId: string;
    run: () => Promise<void>;
}
export declare function cancelCursorJobForChat(chatId: string): boolean;
export declare function isCursorJobCancelled(chatId: string): boolean;
export declare function clearCursorJobCancellation(chatId: string): void;
export declare function hasActiveCursorJob(chatId: string): boolean;
export declare function enqueueCursorJob(chatId: string, run: () => Promise<void>): {
    ok: true;
    jobId: string;
} | {
    ok: false;
    reason: 'busy';
};
//# sourceMappingURL=cursor-job-queue.d.ts.map