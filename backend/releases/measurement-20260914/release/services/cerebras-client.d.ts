import { type GroqAnalysis } from './groq-client';
export interface CerebrasAnalyzeRequest {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
}
export declare function analyzeViaCerebras(params: CerebrasAnalyzeRequest): Promise<GroqAnalysis>;
//# sourceMappingURL=cerebras-client.d.ts.map