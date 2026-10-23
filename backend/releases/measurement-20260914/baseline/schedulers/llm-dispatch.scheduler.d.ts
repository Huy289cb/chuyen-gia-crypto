/**
 * LLM Dispatch Scheduler
 * Processes valid signals from market scan and dispatches to Groq
 * Only processes signals that passed the signal gate
 */
/**
 * Start LLM dispatch scheduler
 */
export declare function startLLMDispatchScheduler(cronExpression?: string): void;
/**
 * Stop LLM dispatch scheduler
 */
export declare function stopLLMDispatchScheduler(): void;
/**
 * Run LLM dispatch manually (for testing)
 */
export declare function runManualLLMDispatch(): Promise<void>;
//# sourceMappingURL=llm-dispatch.scheduler.d.ts.map