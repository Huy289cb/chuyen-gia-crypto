// Groq API Client Wrapper
// Handles API calls with retry logic and error handling

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['qwen/qwen3-32b', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

// Rate limiting protection
let lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2 seconds minimum between calls

// Function to clean JSON response from models that add extra text
function cleanJSONResponse(rawResponse) {
  try {
    // Find the first { and last }
    const start = rawResponse.indexOf('{');
    const end = rawResponse.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error("Không tìm thấy JSON");
    
    const jsonString = rawResponse.substring(start, end + 1);
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("Lỗi parse JSON thủ công:", e);
    return null;
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
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = GROQ_API_URL;
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

      let lastError;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[GroqClient] Model ${currentModel} - Attempt ${attempt + 1}/${maxRetries + 1}`);

          const response = await fetchWithTimeout(this.baseUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          }, 30000); // 30s timeout for Groq API

          if (!response.ok) {
            const errorText = await response.text();

            // If 429 error, try next model instead of retrying
            if (response.status === 429) {
              console.log(`[GroqClient] Model ${currentModel} hit rate limit (429), switching to next model...`);
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

          // If it's a 429 error, break to try next model
          if (error.message.includes('429') || error.message.includes('rate limit')) {
            console.log(`[GroqClient] Model ${currentModel} rate limited, will try next model`);
            break;
          }

          if (attempt < maxRetries) {
            let delay;

            // Check for specific 429 rate limit error
            if (error.message.includes('429') || error.message.includes('rate limit')) {
              // For 429 errors, use much longer delays
              delay = Math.min(60000, Math.pow(2, attempt) * 5000); // Start at 5s, max 60s
              console.log(`[GroqClient] Rate limit detected, waiting ${delay}ms before retry...`);
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
export function createGroqClient(apiKey) {
  if (!apiKey) {
    console.log('[GroqClient] No API key provided, client will use fallback');
    return null;
  }
  return new GroqClient(apiKey);
}

export { GroqClient };
