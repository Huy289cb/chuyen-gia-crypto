/**
 * Groq API Client Wrapper (TypeScript)
 * Handles API calls with retry logic and error handling
 */

import {
  getGroqDispatchFallbackModels,
  getGroqModelChain,
  getGroqPrimaryModel,
} from '../config/groq-models';
import { isCerebrasDispatchFallbackEnabled } from '../config/cerebras-models';
import {
  isOpenRouterDispatchFallbackEnabled,
  isOpenRouterPrimaryProvider,
} from '../config/openrouter-models';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqAnalysisRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxRetries?: number;
  /** If set, only these models are tried (in order). Saves cost for auxiliary calls (e.g. levels adapter). */
  preferredModels?: string[];
}

export interface GroqTextRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  preferredModels?: string[];
}

export interface GroqAnalysis {
  bias: string;
  action: string;
  confidence: number;
  suggested_entry?: number;
  suggested_stop_loss?: number;
  suggested_take_profit?: number;
  expected_rr?: number;
  invalidation_level?: number;
  position_decisions?: any[];
  pending_order_decisions?: any[];
  reason_summary?: string;
  [key: string]: any;
}

// Get available API keys from environment
function getApiKeys(): string[] | null {
  const keys: string[] = [];
  if (process.env.GROQ_API_KEY_1) keys.push(process.env.GROQ_API_KEY_1);
  if (process.env.GROQ_API_KEY_2) keys.push(process.env.GROQ_API_KEY_2);
  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
  return keys.length > 0 ? keys : null;
}

function isRateLimitErrorMessage(message = ''): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('429') || normalized.includes('rate limit');
}

function isDailyTokenLimitError(message = ''): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('tokens per day') || normalized.includes('tpd');
}

// Rate limiting protection
let lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2 seconds minimum between calls

// Function to clean JSON response from models that add extra text
export function cleanJSONResponse(rawResponse: string): GroqAnalysis | null {
  try {
    // Find the first { and match braces to get complete JSON object
    const start = rawResponse.indexOf('{');
    if (start === -1) throw new Error("Không tìm thấy JSON");

    // Count braces to find matching closing brace
    let braceCount = 0;
    let end = -1;
    for (let i = start; i < rawResponse.length; i++) {
      if (rawResponse[i] === '{') braceCount++;
      else if (rawResponse[i] === '}') braceCount--;

      if (braceCount === 0) {
        end = i;
        break;
      }
    }

    if (end === -1) throw new Error("Không tìm thấy dấu đóng ngoặc phù hợp");

    let jsonString = rawResponse.substring(start, end + 1);
    console.log('[GroqClient] Cleaned JSON string length:', jsonString.length);
    console.log('[GroqClient] Cleaned JSON preview:', jsonString.substring(0, 200));

    // Fix common JSON syntax errors
    jsonString = fixJSONSyntax(jsonString);

    // Try to parse the cleaned JSON
    const parsed = JSON.parse(jsonString) as GroqAnalysis;
    return parsed;
  } catch (e: any) {
    console.error("Lỗi parse JSON thủ công:", e.message);
    console.log('[GroqClient] Raw response length:', rawResponse.length);
    console.log('[GroqClient] Raw response preview:', rawResponse.substring(0, 500));

    return null;
  }
}

// Fix common JSON syntax errors
function fixJSONSyntax(jsonString: string): string {
  try {
    // Remove trailing commas before closing brackets/braces
    jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
    
    // Add missing commas between key-value pairs (common error)
    jsonString = jsonString.replace(/"(\w+)"\s*:/g, (match) => {
      return match;
    });
    
    // Fix double commas
    jsonString = jsonString.replace(/,,/g, ',');
    
    console.log('[GroqClient] Applied JSON syntax fixes');
    return jsonString;
  } catch (e: any) {
    console.error('[GroqClient] Error fixing JSON syntax:', e.message);
    return jsonString;
  }
}

// Validate AI response for consistency and correctness
export function validateAIResponse(response: any, symbol: string): boolean {
  if (!response || !symbol) return true;
  
  const analysis = response[symbol.toLowerCase()];
  if (!analysis) return true;
  
  // Check bias-action consistency
  if (analysis.bias === 'bullish' && analysis.action !== 'buy') {
    throw new Error('Invalid AI response: bullish requires buy action');
  }
  if (analysis.bias === 'bearish' && analysis.action !== 'sell') {
    throw new Error('Invalid AI response: bearish requires sell action');
  }
  if (analysis.bias === 'neutral' && analysis.action !== 'hold') {
    throw new Error('Invalid AI response: neutral requires hold action');
  }
  
  // Check SL/TP placement
  if (analysis.bias === 'bullish') {
    if (analysis.suggested_stop_loss >= analysis.suggested_entry) {
      throw new Error('Invalid AI response: LONG SL must be below entry');
    }
    if (analysis.suggested_take_profit <= analysis.suggested_entry) {
      throw new Error('Invalid AI response: LONG TP must be above entry');
    }
  } else if (analysis.bias === 'bearish') {
    if (analysis.suggested_stop_loss <= analysis.suggested_entry) {
      throw new Error('Invalid AI response: SHORT SL must be above entry');
    }
    if (analysis.suggested_take_profit >= analysis.suggested_entry) {
      throw new Error('Invalid AI response: SHORT TP must be below entry');
    }
  }
  
  return true;
}

// Fetch with timeout to prevent hanging in production
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

class GroqClient {
  private apiKeys: string[];
  private currentKeyIndex: number;
  private baseUrl: string;

  constructor(apiKeys: string | string[]) {
    this.apiKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
    this.currentKeyIndex = 0;
    this.baseUrl = GROQ_API_URL;
  }

  getCurrentApiKey(): string {
    return this.apiKeys[this.currentKeyIndex] || this.apiKeys[0];
  }

  switchToNextApiKey(): void {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    console.log(`[GroqClient] Switching to API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}`);
  }

  resetToFirstApiKey(): void {
    this.currentKeyIndex = 0;
    console.log(`[GroqClient] Resetting to first API key`);
  }

  /**
   * Try a subset of Groq models across all API keys. Returns null when every key/model fails.
   */
  private async tryGroqModels(
    modelsToTry: string[],
    params: {
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      maxRetries: number;
    }
  ): Promise<GroqAnalysis | null> {
    if (modelsToTry.length === 0) return null;

    const { systemPrompt, userPrompt, temperature, maxRetries } = params;
    let lastError: Error | undefined;
    const totalApiKeys = this.apiKeys.length;
    const keysTried = new Set<number>();

    this.resetToFirstApiKey();

    while (keysTried.size < totalApiKeys) {
      const currentKeyIndex = this.currentKeyIndex;
      keysTried.add(currentKeyIndex);
      console.log(
        `[GroqClient] Using API key ${currentKeyIndex + 1}/${totalApiKeys} (tried ${keysTried.size}/${totalApiKeys} keys)`
      );

      for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
        const currentModel = modelsToTry[modelIndex];
        console.log(`[GroqClient] Trying model: ${currentModel}`);

        const requestBody = {
          model: currentModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: 1024,
        };

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            console.log(
              `[GroqClient] Model ${currentModel} - Attempt ${attempt + 1}/${maxRetries + 1}`
            );

            const response = await fetchWithTimeout(
              this.baseUrl,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${this.getCurrentApiKey()}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              },
              30000
            );

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Groq API error: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const content = data.choices?.[0]?.message?.content;

            if (!content) {
              throw new Error('Empty response from Groq API');
            }

            const parsed = cleanJSONResponse(content);
            if (parsed === null) {
              console.error('[GroqClient] Failed to clean JSON from response');
              console.log('[GroqClient] Raw content:', content.substring(0, 200));
              throw new Error('Invalid JSON in response after cleaning');
            }

            console.log(
              `[GroqClient] Successfully parsed response from model ${currentModel} with API key ${currentKeyIndex + 1}`
            );
            return parsed;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            lastError = error instanceof Error ? error : new Error(message);
            console.error(`[GroqClient] Model ${currentModel} - Attempt ${attempt + 1} failed:`, message);

            if (isDailyTokenLimitError(message)) {
              console.warn(
                `[GroqClient] Daily token limit hit for model ${currentModel}, skipping remaining retries for this model`
              );
              break;
            }

            if (attempt < maxRetries) {
              const delay = isRateLimitErrorMessage(message)
                ? 60000
                : Math.pow(2, attempt) * 1000;
              console.log(`[GroqClient] Retrying in ${delay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }
      }

      console.log(
        `[GroqClient] All ${modelsToTry.length} model(s) failed with API key ${currentKeyIndex + 1}/${totalApiKeys}, switching to next key...`
      );
      this.switchToNextApiKey();
    }

    this.resetToFirstApiKey();
    if (lastError) {
      console.error(`[GroqClient] Groq model batch failed: ${lastError.message}`);
    }
    return null;
  }

  private async tryOpenRouterDispatch(
    params: Pick<GroqAnalysisRequest, 'systemPrompt' | 'userPrompt' | 'temperature'>,
    stepLabel: string
  ): Promise<GroqAnalysis | null> {
    if (!isOpenRouterDispatchFallbackEnabled()) return null;
    try {
      console.log(`[GroqClient] ${stepLabel}: OpenRouter Scout`);
      const { analyzeViaOpenRouter } = await import('./openrouter-client');
      return await analyzeViaOpenRouter(params);
    } catch (openRouterErr: unknown) {
      const msg = openRouterErr instanceof Error ? openRouterErr.message : String(openRouterErr);
      console.error(`[GroqClient] OpenRouter dispatch failed: ${msg}`);
      return null;
    }
  }

  private async tryCerebrasDispatch(
    params: Pick<GroqAnalysisRequest, 'systemPrompt' | 'userPrompt' | 'temperature'>,
    stepLabel: string
  ): Promise<GroqAnalysis | null> {
    if (!isCerebrasDispatchFallbackEnabled()) return null;
    try {
      console.log(`[GroqClient] ${stepLabel}: Cerebras gpt-oss fallback`);
      const { analyzeViaCerebras } = await import('./cerebras-client');
      return await analyzeViaCerebras(params);
    } catch (cerebrasErr: unknown) {
      const msg = cerebrasErr instanceof Error ? cerebrasErr.message : String(cerebrasErr);
      console.error(`[GroqClient] Cerebras dispatch fallback failed: ${msg}`);
      return null;
    }
  }

  /**
   * Dispatch fallback order (groq default):
   * 1. Groq primary (Scout)
   * 2. Cerebras gpt-oss-120b + json_object
   * 3. OpenRouter Scout + json_object
   * 4+ Other Groq fallbacks
   *
   * LLM_PROVIDER=openrouter (mainnet):
   * 1. OpenRouter Scout
   * 2. Groq primary
   * 3. Cerebras
   * 4+ Groq fallbacks
   */
  private async analyzeDispatchChain(params: GroqAnalysisRequest): Promise<GroqAnalysis> {
    const { systemPrompt, userPrompt, temperature = 0.2, maxRetries = 5 } = params;
    const groqParams = { systemPrompt, userPrompt, temperature, maxRetries };
    const llmParams = { systemPrompt, userPrompt, temperature };

    if (isOpenRouterPrimaryProvider()) {
      const openRouterPrimary = await this.tryOpenRouterDispatch(llmParams, 'Dispatch step 1');
      if (openRouterPrimary) return openRouterPrimary;

      const primary = getGroqPrimaryModel();
      console.log(`[GroqClient] Dispatch step 2: Groq primary ${primary}`);
      const groqPrimary = await this.tryGroqModels([primary], groqParams);
      if (groqPrimary) return groqPrimary;

      const cerebrasResult = await this.tryCerebrasDispatch(llmParams, 'Dispatch step 3');
      if (cerebrasResult) return cerebrasResult;
    } else {
      const primary = getGroqPrimaryModel();
      console.log(`[GroqClient] Dispatch step 1: Groq primary ${primary}`);
      const primaryResult = await this.tryGroqModels([primary], groqParams);
      if (primaryResult) return primaryResult;

      const cerebrasResult = await this.tryCerebrasDispatch(llmParams, 'Dispatch step 2');
      if (cerebrasResult) return cerebrasResult;

      const openRouterFallback = await this.tryOpenRouterDispatch(llmParams, 'Dispatch step 3');
      if (openRouterFallback) return openRouterFallback;
    }

    const groqFallbacks = getGroqDispatchFallbackModels();
    if (groqFallbacks.length > 0) {
      console.log(
        `[GroqClient] Dispatch step 4+: Groq fallbacks (${groqFallbacks.join(', ')})`
      );
      const fallbackResult = await this.tryGroqModels(groqFallbacks, groqParams);
      if (fallbackResult) return fallbackResult;
    }

    throw new Error('All dispatch providers failed');
  }

  /**
   * Send chat completion request to Groq API
   */
  async analyze(params: GroqAnalysisRequest): Promise<GroqAnalysis> {
    const { systemPrompt, userPrompt, temperature = 0.2, maxRetries = 5, preferredModels } = params;

    // Rate limiting protection
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < MIN_CALL_INTERVAL) {
      const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
      console.log(`[GroqClient] Rate limiting: waiting ${waitTime}ms before API call`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastCallTime = Date.now();

    if (!preferredModels || preferredModels.length === 0) {
      return this.analyzeDispatchChain(params);
    }

    const result = await this.tryGroqModels(preferredModels, {
      systemPrompt,
      userPrompt,
      temperature,
      maxRetries,
    });
    if (result) return result;

    throw new Error(`All models failed with all API keys for preferredModels`);
  }

  /**
   * Plain-text completion for ops Q&A (Telegram AI). No JSON parsing.
   */
  async completeText(params: GroqTextRequest): Promise<string> {
    const {
      systemPrompt,
      userPrompt,
      temperature = 0.3,
      maxTokens = 2048,
      maxRetries = 3,
      preferredModels,
    } = params;

    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < MIN_CALL_INTERVAL) {
      const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
      console.log(`[GroqOps] Rate limiting: waiting ${waitTime}ms before API call`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastCallTime = Date.now();

    let lastError: Error | undefined;
    const totalApiKeys = this.apiKeys.length;
    const keysTried = new Set<number>();

    while (keysTried.size < totalApiKeys) {
      const currentKeyIndex = this.currentKeyIndex;
      keysTried.add(currentKeyIndex);
      console.log(
        `[GroqOps] Using API key ${currentKeyIndex + 1}/${totalApiKeys} (tried ${keysTried.size}/${totalApiKeys} keys)`
      );

      const modelsToTry =
        preferredModels && preferredModels.length > 0 ? preferredModels : getGroqModelChain();

      for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
        const currentModel = modelsToTry[modelIndex];
        console.log(`[GroqOps] Trying model: ${currentModel}`);

        const requestBody = {
          model: currentModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        };

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            console.log(
              `[GroqOps] Model ${currentModel} - Attempt ${attempt + 1}/${maxRetries + 1}`
            );

            const response = await fetchWithTimeout(
              this.baseUrl,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${this.getCurrentApiKey()}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              },
              30000
            );

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Groq API error: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const content = data.choices?.[0]?.message?.content;

            if (!content || !content.trim()) {
              throw new Error('Empty response from Groq API');
            }

            console.log(
              `[GroqOps] Text completion OK model=${currentModel} len=${content.length}`
            );
            return content.trim();
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            lastError = error instanceof Error ? error : new Error(message);
            console.error(
              `[GroqOps] Model ${currentModel} - Attempt ${attempt + 1} failed:`,
              message
            );

            if (isDailyTokenLimitError(message)) break;

            if (attempt < maxRetries) {
              const delay = isRateLimitErrorMessage(message)
                ? 60000
                : Math.pow(2, attempt) * 1000;
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }
      }

      console.log(
        `[GroqOps] All models failed with API key ${currentKeyIndex + 1}/${totalApiKeys}, switching...`
      );
      this.switchToNextApiKey();
    }

    this.resetToFirstApiKey();
    throw new Error(`Groq text completion failed: ${lastError?.message}`);
  }

  /**
   * Check if API key is valid by making a test request
   */
  async validateKey(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKeys[0]}`
        }
      }, 10000); // 10s timeout for validation
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Factory function for easy instantiation
export function createGroqClient(apiKeyOrKeys?: string | string[]): GroqClient | null {
  const keys =
    apiKeyOrKeys === undefined || apiKeyOrKeys === null
      ? getApiKeys()
      : Array.isArray(apiKeyOrKeys)
        ? apiKeyOrKeys
        : [apiKeyOrKeys];
  if (!keys || keys.length === 0) {
    console.log('[GroqClient] No API key provided, client will use fallback');
    return null;
  }
  console.log(`[GroqClient] Initialized with ${keys.length} API key(s)`);
  return new GroqClient(keys);
}

export { GroqClient };
