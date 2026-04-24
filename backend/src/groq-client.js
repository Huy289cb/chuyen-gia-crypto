// Groq API Client Wrapper
// Handles API calls with retry logic and error handling

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'];

// Get available API keys from environment
function getApiKeys() {
  const keys = [];
  if (process.env.GROQ_API_KEY_1) keys.push(process.env.GROQ_API_KEY_1);
  if (process.env.GROQ_API_KEY_2) keys.push(process.env.GROQ_API_KEY_2);
  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
  return keys.length > 0 ? keys : null;
}

// Rate limiting protection
let lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2 seconds minimum between calls

// Function to clean JSON response from models that add extra text
function cleanJSONResponse(rawResponse) {
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
    const parsed = JSON.parse(jsonString);
    return parsed;
  } catch (e) {
    console.error("Lỗi parse JSON thủ công:", e.message);
    console.log('[GroqClient] Raw response length:', rawResponse.length);
    console.log('[GroqClient] Raw response preview:', rawResponse.substring(0, 500));

    return null;
  }
}

// Fix common JSON syntax errors
function fixJSONSyntax(jsonString) {
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
  } catch (e) {
    console.error('[GroqClient] Error fixing JSON syntax:', e.message);
    return jsonString;
  }
}

// Fetch with timeout to prevent hanging in production
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

class GroqClient {
  constructor(apiKeys) {
    this.apiKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
    this.currentKeyIndex = 0;
    this.baseUrl = GROQ_API_URL;
  }

  getCurrentApiKey() {
    return this.apiKeys[this.currentKeyIndex] || this.apiKeys[0];
  }

  switchToNextApiKey() {
    if (this.currentKeyIndex < this.apiKeys.length - 1) {
      this.currentKeyIndex++;
      console.log(`[GroqClient] Switching to API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}`);
      return true;
    }
    return false;
  }

  /**
   * Send chat completion request to Groq API
   * @param {Object} params - Request parameters
   * @param {string} params.systemPrompt - System prompt
   * @param {string} params.userPrompt - User prompt
   * @param {number} params.temperature - Temperature (0-1)
   * @param {number} params.maxRetries - Max retry attempts
   * @returns {Promise<Object>} Parsed JSON response
   */
  async analyze({ systemPrompt, userPrompt, temperature = 0.2, maxRetries = 5 }) {
    // Rate limiting protection
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    if (timeSinceLastCall < MIN_CALL_INTERVAL) {
      const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
      console.log(`[GroqClient] Rate limiting: waiting ${waitTime}ms before API call`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastCallTime = Date.now();

    let lastError;

    // Try each model in sequence, starting with the first one
    for (let modelIndex = 0; modelIndex < MODELS.length; modelIndex++) {
      const currentModel = MODELS[modelIndex];
      console.log(`[GroqClient] Trying model: ${currentModel}`);

      const requestBody = {
        model: currentModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: 1024
        // Disable response_format json_object to allow manual JSON cleaning
        // response_format: { type: 'json_object' }
      };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[GroqClient] Model ${currentModel} - Attempt ${attempt + 1}/${maxRetries + 1}`);

          const response = await fetchWithTimeout(this.baseUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.getCurrentApiKey()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          }, 30000); // 30s timeout for Groq API

          if (!response.ok) {
            const errorText = await response.text();

            // If 429 or 404 error, try next API key instead of retrying
            if (response.status === 429 || response.status === 404) {
              console.log(`[GroqClient] Model ${currentModel} hit rate limit (429) or not found (404), trying next API key...`);
              if (this.switchToNextApiKey()) {
                attempt = -1; // Reset attempt counter to retry with new key
                continue;
              }
              console.log(`[GroqClient] No more API keys available, switching to next model...`);
              break; // Break out of retry loop to try next model
            }

            throw new Error(`Groq API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          const content = data.choices[0]?.message?.content;

          if (!content) {
            throw new Error('Empty response from Groq API');
          }

          // Parse JSON response using cleanJSONResponse to handle extra text
          const parsed = cleanJSONResponse(content);
          if (parsed === null) {
            console.error('[GroqClient] Failed to clean JSON from response');
            console.log('[GroqClient] Raw content:', content.substring(0, 200));
            throw new Error('Invalid JSON in response after cleaning');
          }

          console.log(`[GroqClient] Successfully parsed response from model ${currentModel}`);
          return parsed;

        } catch (error) {
          lastError = error;
          console.error(`[GroqClient] Model ${currentModel} - Attempt ${attempt + 1} failed:`, error.message);

          if (attempt < maxRetries) {
            let delay;

            // Check for specific 429 rate limit error
            if (error.message.includes('429') || error.message.includes('rate limit')) {
              // For 429 errors, use much longer delays (1 minute minimum)
              delay = 60000; // Fixed 1 minute wait for rate limits
              console.log(`[GroqClient] Rate limit detected, waiting ${delay}ms (1 minute) before retry...`);
            } else {
              // For other errors, use normal exponential backoff
              delay = Math.pow(2, attempt) * 1000;
              console.log(`[GroqClient] Retrying in ${delay}ms...`);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
    }

    throw new Error(`All models failed: ${lastError.message}`);
  }

  /**
   * Check if API key is valid by making a test request
   * @returns {Promise<boolean>}
   */
  async validateKey() {
    try {
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      }, 10000); // 10s timeout for validation
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Factory function for easy instantiation
export function createGroqClient(apiKeyOrKeys) {
  const keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : getApiKeys();
  if (!keys || keys.length === 0) {
    console.log('[GroqClient] No API key provided, client will use fallback');
    return null;
  }
  console.log(`[GroqClient] Initialized with ${keys.length} API key(s)`);
  return new GroqClient(keys);
}

export { GroqClient };
