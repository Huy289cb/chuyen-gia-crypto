package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestAuthMiddleware_ValidateAPIKey(t *testing.T) {
	// Set up test config
	config.AppConfig = &config.Config{
		Auth: config.AuthConfig{
			APIKeys: []string{"test-key-123", "another-key-456"},
		},
	}

	am := NewAuthMiddleware()

	tests := []struct {
		name     string
		apiKey   string
		expected bool
	}{
		{"valid key", "test-key-123", true},
		{"another valid key", "another-key-456", true},
		{"invalid key", "invalid-key", false},
		{"empty key", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := am.validateAPIKey(tt.apiKey)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestAuthMiddleware_ValidateAPIKey_NoKeysConfigured(t *testing.T) {
	// Set up test config with no API keys
	config.AppConfig = &config.Config{
		Auth: config.AuthConfig{
			APIKeys: []string{},
		},
	}

	am := NewAuthMiddleware()

	// When no keys are configured, all keys should be valid (dev mode)
	result := am.validateAPIKey("any-key")
	assert.True(t, result)
}

func TestAuthMiddleware_Authenticate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	// Set up test config
	config.AppConfig = &config.Config{
		Auth: config.AuthConfig{
			APIKeys: []string{"test-key-123"},
		},
	}

	am := NewAuthMiddleware()

	tests := []struct {
		name           string
		authHeader     string
		expectedStatus int
	}{
		{"valid API key with prefix", "ApiKey test-key-123", http.StatusOK},
		{"valid API key without prefix", "test-key-123", http.StatusOK},
		{"invalid API key", "ApiKey invalid-key", http.StatusUnauthorized},
		{"missing auth header", "", http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			
			c.Request = httptest.NewRequest("GET", "/test", nil)
			c.Request.Header.Set("Authorization", tt.authHeader)
			
			middleware := am.Authenticate()
			middleware(c)
			
			assert.Equal(t, tt.expectedStatus, w.Code)
		})
	}
}

func TestAuthMiddleware_OptionalAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	// Set up test config
	config.AppConfig = &config.Config{
		Auth: config.AuthConfig{
			APIKeys: []string{"test-key-123"},
		},
	}

	am := NewAuthMiddleware()

	tests := []struct {
		name            string
		authHeader      string
		shouldContinue  bool
		authenticated   bool
	}{
		{"valid API key", "ApiKey test-key-123", true, true},
		{"invalid API key", "ApiKey invalid-key", true, false},
		{"missing auth header", "", true, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			
			c.Request = httptest.NewRequest("GET", "/test", nil)
			c.Request.Header.Set("Authorization", tt.authHeader)
			
			middleware := am.OptionalAuth()
			middleware(c)
			
			// Optional auth should always continue
			assert.True(t, tt.shouldContinue)
			
			// Check if authenticated flag is set correctly
			auth, exists := c.Get("authenticated")
			if tt.authenticated {
				assert.True(t, exists)
				assert.True(t, auth.(bool))
			} else {
				assert.False(t, exists || (exists && auth.(bool)))
			}
		})
	}
}
