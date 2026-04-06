// Groq API Client Wrapper
// Handles API calls with retry logic and error handling

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const FALLBACK_MODEL = 'llama3-8b-8192';

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
  async analyze({ systemPrompt, userPrompt, temperature = 0.2, maxRetries = 2 }) {
    const requestBody = {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    };

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[GroqClient] Attempt ${attempt + 1}/${maxRetries + 1}`);
        
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Groq API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        
        if (!content) {
          throw new Error('Empty response from Groq API');
        }

        // Parse JSON response
        try {
          const parsed = JSON.parse(content);
          console.log('[GroqClient] Successfully parsed response');
          return parsed;
        } catch (parseError) {
          console.error('[GroqClient] JSON parse error:', parseError.message);
          console.log('[GroqClient] Raw content:', content.substring(0, 200));
          throw new Error('Invalid JSON in response');
        }

      } catch (error) {
        lastError = error;
        console.error(`[GroqClient] Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`[GroqClient] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`All ${maxRetries + 1} attempts failed: ${lastError.message}`);
  }

  /**
   * Check if API key is valid by making a test request
   * @returns {Promise<boolean>}
   */
  async validateKey() {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
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
