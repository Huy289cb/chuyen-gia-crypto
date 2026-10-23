import { type GroqAnalysis } from './groq-client';
export interface OpenRouterAnalyzeRequest {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    /** Override dispatch model (e.g. levels adapter). */
    model?: string;
    logLabel?: string;
    /** Parse retries on bad JSON (default 3). */
    maxParseRetries?: number;
}
/** Normalize OpenRouter message.content (string | multipart array). */
export declare function extractOpenRouterMessageContent(data: unknown): string;
export declare function analyzeViaOpenRouter(params: OpenRouterAnalyzeRequest): Promise<GroqAnalysis>;
//# sourceMappingURL=openrouter-client.d.ts.map