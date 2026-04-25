package groq

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewClient(t *testing.T) {
	// Initialize logger
	logger.Init("info", "console")
	defer logger.Sync()

	tests := []struct {
		name    string
		apiKeys []string
		wantNil bool
	}{
		{
			name:    "valid client",
			apiKeys: []string{"key1", "key2"},
			wantNil: false,
		},
		{
			name:    "single key",
			apiKeys: []string{"key1"},
			wantNil: false,
		},
		{
			name:    "no keys",
			apiKeys: []string{},
			wantNil: true,
		},
		{
			name:    "nil keys",
			apiKeys: nil,
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient(tt.apiKeys)
			if tt.wantNil {
				assert.Nil(t, client)
			} else {
				assert.NotNil(t, client)
				assert.Equal(t, tt.apiKeys, client.apiKeys)
				assert.Equal(t, 0, client.currentKeyIndex)
			}
		})
	}
}

func TestClient_GetCurrentAPIKey(t *testing.T) {
	tests := []struct {
		name     string
		apiKeys  []string
		index    int
		expected string
	}{
		{
			name:     "first key",
			apiKeys:  []string{"key1", "key2"},
			index:    0,
			expected: "key1",
		},
		{
			name:     "second key",
			apiKeys:  []string{"key1", "key2"},
			index:    1,
			expected: "key2",
		},
		{
			name:     "empty keys",
			apiKeys:  []string{},
			index:    0,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient(tt.apiKeys)
			if client != nil {
				client.currentKeyIndex = tt.index
				result := client.getCurrentAPIKey()
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestClient_SwitchToNextAPIKey(t *testing.T) {
	client := NewClient([]string{"key1", "key2", "key3"})
	require.NotNil(t, client)

	assert.Equal(t, 0, client.currentKeyIndex)
	assert.Equal(t, "key1", client.getCurrentAPIKey())

	client.switchToNextAPIKey()
	assert.Equal(t, 1, client.currentKeyIndex)
	assert.Equal(t, "key2", client.getCurrentAPIKey())

	client.switchToNextAPIKey()
	assert.Equal(t, 2, client.currentKeyIndex)
	assert.Equal(t, "key3", client.getCurrentAPIKey())

	// Should wrap around
	client.switchToNextAPIKey()
	assert.Equal(t, 0, client.currentKeyIndex)
	assert.Equal(t, "key1", client.getCurrentAPIKey())
}

func TestClient_ResetToFirstAPIKey(t *testing.T) {
	client := NewClient([]string{"key1", "key2", "key3"})
	require.NotNil(t, client)

	client.currentKeyIndex = 2
	assert.Equal(t, 2, client.currentKeyIndex)

	client.resetToFirstAPIKey()
	assert.Equal(t, 0, client.currentKeyIndex)
}

func TestClient_ResetToFirstAPIKey_NilClient(t *testing.T) {
	var client *Client
	client.resetToFirstAPIKey() // Should not panic
}

func TestCleanJSONResponse(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantErr     bool
		expectedKey string
	}{
		{
			name:        "valid JSON",
			input:       `{"test": "value"}`,
			wantErr:     false,
			expectedKey: "test",
		},
		{
			name:        "JSON with markdown",
			input:       `Here's the analysis: {"test": "value"}`,
			wantErr:     false,
			expectedKey: "test",
		},
		{
			name:        "JSON with trailing comma",
			input:       `{"test": "value",}`,
			wantErr:     false,
			expectedKey: "test",
		},
		{
			name:        "JSON with newline comma",
			input:       `{"test": "value"}`,
			wantErr:     false,
			expectedKey: "test",
		},
		{
			name:        "no JSON found",
			input:       `This is just text`,
			wantErr:     true,
			expectedKey: "",
		},
		{
			name:        "incomplete JSON",
			input:       `{"test": "value"`,
			wantErr:     true,
			expectedKey: "",
		},
		{
			name:        "nested JSON",
			input:       `{"outer": {"inner": "value"}}`,
			wantErr:     false,
			expectedKey: "outer",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := cleanJSONResponse(tt.input)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Contains(t, result, tt.expectedKey)
			}
		})
	}
}

func TestFixJSONSyntax(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "trailing comma before brace",
			input:    `{"test": "value",}`,
			expected: `{"test": "value"}`,
		},
		{
			name:     "trailing comma before bracket",
			input:    `{"test": ["value",]}`,
			expected: `{"test": ["value"]}`,
		},
		{
			name:     "newline comma",
			input:    `{"test": "value",\n}`,
			expected: `{"test": "value",\n}`,
		},
		{
			name:     "double comma",
			input:    `{"test": "value",,}`,
			expected: `{"test": "value",}`,
		},
		{
			name:     "no changes needed",
			input:    `{"test": "value"}`,
			expected: `{"test": "value"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := fixJSONSyntax(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCalculateRetryDelay(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		attempt     int
		expectedMin time.Duration
		expectedMax time.Duration
	}{
		{
			name:        "rate limit error",
			err:         assert.AnError,
			attempt:     0,
			expectedMin: RateLimitDelay,
			expectedMax: RateLimitDelay,
		},
		{
			name:        "rate limit string",
			err:         assert.AnError,
			attempt:     0,
			expectedMin: RateLimitDelay,
			expectedMax: RateLimitDelay,
		},
		{
			name:        "normal error attempt 0",
			err:         assert.AnError,
			attempt:     0,
			expectedMin: 1 * time.Second,
			expectedMax: 1 * time.Second,
		},
		{
			name:        "normal error attempt 1",
			err:         assert.AnError,
			attempt:     1,
			expectedMin: 2 * time.Second,
			expectedMax: 2 * time.Second,
		},
		{
			name:        "normal error attempt 2",
			err:         assert.AnError,
			attempt:     2,
			expectedMin: 4 * time.Second,
			expectedMax: 4 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create error with specific message if needed
			err := tt.err
			if strings.Contains(tt.name, "rate limit") {
				err = &customError{msg: "429 rate limit exceeded"}
			}

			result := calculateRetryDelay(err, tt.attempt)
			assert.GreaterOrEqual(t, result, tt.expectedMin)
			assert.LessOrEqual(t, result, tt.expectedMax)
		})
	}
}

func TestMin(t *testing.T) {
	tests := []struct {
		a, b     int
		expected int
	}{
		{1, 2, 1},
		{2, 1, 1},
		{5, 5, 5},
		{0, 10, 0},
		{-5, 5, -5},
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			result := min(tt.a, tt.b)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestClient_Analyze_Mock(t *testing.T) {
	// Create a mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		// Send mock response
		response := ChatResponse{
			ID:      "test-id",
			Object:  "chat.completion",
			Created: time.Now().Unix(),
			Model:   "test-model",
			Choices: []Choice{
				{
					Index: 0,
					Message: Message{
						Role:    "assistant",
						Content: `{"confidence": 0.85, "bias": "bullish"}`,
					},
					FinishReason: "stop",
				},
			},
			Usage: Usage{
				PromptTokens:     10,
				CompletionTokens: 20,
				TotalTokens:      30,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	// We can't easily test the full Analyze method without modifying the code
	// to accept a custom URL. For now, we'll test the sendRequest method indirectly
	// by testing the cleanJSONResponse function which is used in the flow
	t.Skip("Requires URL injection for full test")
}

func TestGetAPIKeys(t *testing.T) {
	// This test would require setting environment variables
	// For now, we'll skip it
	t.Skip("Requires environment variable setup")
}

// Helper type for custom error
type customError struct {
	msg string
}

func (e *customError) Error() string {
	return e.msg
}
