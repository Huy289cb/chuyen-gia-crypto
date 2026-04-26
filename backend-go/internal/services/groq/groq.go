package groq

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

const (
	GroqAPIURL      = "https://api.groq.com/openai/v1/chat/completions"
	MinCallInterval = 2 * time.Second
	RequestTimeout  = 30 * time.Second
	MaxRetries      = 5
	RateLimitDelay  = 60 * time.Second
)

var (
	models = []string{
		"meta-llama/llama-4-scout-17b-16e-instruct",
		"llama-3.3-70b-versatile",
		"llama-3.1-8b-instant",
		"qwen/qwen3-32b",
		"openai/gpt-oss-120b",
	}
	lastCallTime time.Time
	callMutex    sync.Mutex
)

// Message represents a chat message
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest represents a chat completion request
type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
	MaxTokens   int       `json:"max_tokens"`
}

// ChatResponse represents a chat completion response
type ChatResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"`
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage"`
}

// Choice represents a choice in the response
type Choice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

// Usage represents token usage
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// Client represents a Groq API client
type Client struct {
	apiKeys         []string
	currentKeyIndex int
	httpClient      *http.Client
}

// NewClient creates a new Groq client
func NewClient(apiKeys []string) *Client {
	if len(apiKeys) == 0 {
		logger.Warn("No API keys provided for Groq client")
		return nil
	}

	logger.Info("Groq client initialized",
		zap.Int("api_keys_count", len(apiKeys)),
	)

	return &Client{
		apiKeys:    apiKeys,
		httpClient: &http.Client{Timeout: RequestTimeout},
	}
}

// getCurrentAPIKey returns the current API key
func (c *Client) getCurrentAPIKey() string {
	if c == nil || len(c.apiKeys) == 0 {
		return ""
	}
	return c.apiKeys[c.currentKeyIndex]
}

// switchToNextAPIKey switches to the next API key
func (c *Client) switchToNextAPIKey() {
	if c == nil || len(c.apiKeys) == 0 {
		return
	}
	c.currentKeyIndex = (c.currentKeyIndex + 1) % len(c.apiKeys)
	logger.Info("Switched to next API key",
		zap.Int("key_index", c.currentKeyIndex+1),
		zap.Int("total_keys", len(c.apiKeys)),
	)
}

// resetToFirstAPIKey resets to the first API key
func (c *Client) resetToFirstAPIKey() {
	if c == nil {
		return
	}
	c.currentKeyIndex = 0
	logger.Info("Reset to first API key")
}

// Analyze sends a chat completion request to Groq API
func (c *Client) Analyze(ctx context.Context, systemPrompt, userPrompt string, temperature float64) (map[string]interface{}, error) {
	if c == nil {
		return nil, errors.NewAPIError("Groq client is not initialized", nil)
	}

	// Rate limiting protection
	callMutex.Lock()
	timeSinceLastCall := time.Since(lastCallTime)
	if timeSinceLastCall < MinCallInterval {
		waitTime := MinCallInterval - timeSinceLastCall
		logger.Info("Rate limiting: waiting before API call",
			zap.Duration("wait_time", waitTime),
		)
		time.Sleep(waitTime)
	}
	lastCallTime = time.Now()
	callMutex.Unlock()

	var lastError error
	totalApiKeys := len(c.apiKeys)
	startingKeyIndex := c.currentKeyIndex
	keysTried := make(map[int]bool)

	// Try current key first, then try other keys if current fails
	for len(keysTried) < totalApiKeys {
		currentKeyIndex := c.currentKeyIndex
		keysTried[currentKeyIndex] = true

		logger.Info("Using API key",
			zap.Int("key_index", currentKeyIndex+1),
			zap.Int("total_keys", totalApiKeys),
			zap.Int("keys_tried", len(keysTried)),
		)

		// Try each model with current API key
		for modelIndex := 0; modelIndex < len(models); modelIndex++ {
			currentModel := models[modelIndex]
			logger.Info("Trying model", zap.String("model", currentModel))

			requestBody := ChatRequest{
				Model: currentModel,
				Messages: []Message{
					{Role: "system", Content: systemPrompt},
					{Role: "user", Content: userPrompt},
				},
				Temperature: temperature,
				MaxTokens:   1024,
			}

			// Retry loop for this model
			for attempt := 0; attempt <= MaxRetries; attempt++ {
				logger.Info("Model attempt",
					zap.String("model", currentModel),
					zap.Int("attempt", attempt+1),
					zap.Int("max_retries", MaxRetries+1),
				)

				response, err := c.sendRequest(ctx, requestBody)
				if err != nil {
					lastError = err
					logger.Error("Model attempt failed",
						zap.String("model", currentModel),
						zap.Int("attempt", attempt+1),
						zap.Error(err),
					)

					if attempt < MaxRetries {
						delay := calculateRetryDelay(err, attempt)
						logger.Info("Retrying", zap.Duration("delay", delay))
						time.Sleep(delay)
					}
					continue
				}

				// Successfully got response
				logger.Info("Successfully parsed response",
					zap.String("model", currentModel),
					zap.Int("key_index", currentKeyIndex+1),
				)
				return response, nil
			}
		}

		// All models failed with current key, switch to next key
		logger.Info("All models failed with current key, switching to next key")
		c.switchToNextAPIKey()
	}

	// All keys failed, reset to first key for next attempt
	c.currentKeyIndex = startingKeyIndex
	logger.Info("All API keys failed, resetting to first key")
	return nil, errors.NewAPIError(fmt.Sprintf("all models failed with all API keys: %v", lastError), lastError)
}

// sendRequest sends an HTTP request to Groq API
func (c *Client) sendRequest(ctx context.Context, requestBody ChatRequest) (map[string]interface{}, error) {
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		return nil, errors.NewAPIError("failed to marshal request body", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", GroqAPIURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, errors.NewAPIError("failed to create request", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.getCurrentAPIKey())
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, errors.NewAPIError("request failed", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, errors.NewAPIError(fmt.Sprintf("Groq API error: %d - %s", resp.StatusCode, string(body)), nil)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.NewAPIError("failed to read response body", err)
	}

	var chatResponse ChatResponse
	if err := json.Unmarshal(body, &chatResponse); err != nil {
		return nil, errors.NewAPIError("failed to unmarshal response", err)
	}

	if len(chatResponse.Choices) == 0 {
		return nil, errors.NewAPIError("empty response from Groq API", nil)
	}

	content := chatResponse.Choices[0].Message.Content
	if content == "" {
		return nil, errors.NewAPIError("empty content in response", nil)
	}

	// Clean JSON response
	parsed, err := cleanJSONResponse(content)
	if err != nil {
		previewLen := min(200, len(content))
		logger.Error("Failed to clean JSON response",
			zap.Error(err),
			zap.String("content_preview", content[:previewLen]),
		)
		return nil, errors.NewAPIError("invalid JSON in response after cleaning", err)
	}

	return parsed, nil
}

// cleanJSONResponse extracts and cleans JSON from model response
func cleanJSONResponse(rawResponse string) (map[string]interface{}, error) {
	// Find the first { and match braces to get complete JSON object
	start := strings.Index(rawResponse, "{")
	if start == -1 {
		return nil, fmt.Errorf("no JSON found in response")
	}

	// Count braces to find matching closing brace
	braceCount := 0
	end := -1
	for i := start; i < len(rawResponse); i++ {
		if rawResponse[i] == '{' {
			braceCount++
		} else if rawResponse[i] == '}' {
			braceCount--
		}

		if braceCount == 0 {
			end = i
			break
		}
	}

	if end == -1 {
		return nil, fmt.Errorf("no matching closing brace found")
	}

	jsonString := rawResponse[start : end+1]
	logger.Debug("Cleaned JSON string",
		zap.Int("length", len(jsonString)),
		zap.String("preview", jsonString[:min(200, len(jsonString))]),
	)

	// Fix common JSON syntax errors
	jsonString = fixJSONSyntax(jsonString)

	// Try to parse the cleaned JSON
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(jsonString), &result); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	return result, nil
}

// fixJSONSyntax fixes common JSON syntax errors
func fixJSONSyntax(jsonString string) string {
	// Remove trailing commas before closing brackets/braces
	jsonString = strings.ReplaceAll(jsonString, ",\n", "\n")
	jsonString = strings.ReplaceAll(jsonString, ",}", "}")
	jsonString = strings.ReplaceAll(jsonString, ",]", "]")

	// Fix double commas
	jsonString = strings.ReplaceAll(jsonString, ",,", ",")

	logger.Debug("Applied JSON syntax fixes")
	return jsonString
}

// calculateRetryDelay calculates delay for retry based on error
func calculateRetryDelay(err error, attempt int) time.Duration {
	if strings.Contains(err.Error(), "429") || strings.Contains(strings.ToLower(err.Error()), "rate limit") {
		return RateLimitDelay
	}
	return time.Duration(1<<uint(attempt)) * time.Second
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// GetAPIKeys retrieves API keys from environment
func GetAPIKeys() []string {
	keys := []string{}

	if key := config.AppConfig.Groq.APIKey; key != "" {
		keys = append(keys, key)
	}

	// Support multiple keys via environment variables
	// GROQ_API_KEY_1, GROQ_API_KEY_2, etc.
	for i := 1; i <= 5; i++ {
		key := getEnv(fmt.Sprintf("GROQ_API_KEY_%d", i))
		if key != "" {
			keys = append(keys, key)
		}
	}

	return keys
}

// getEnv gets environment variable (helper function)
func getEnv(key string) string {
	return os.Getenv(key)
}
